'use strict';
/**
 * 자체 서명 인증서로 Windows 실행 파일에 Authenticode 서명을 넣는다.
 * signtool(Windows)이나 osslsigncode 없이 순수 JS(resedit)와 Node 의 crypto 만 쓴다.
 *
 * 주의: resedit 는 PE 해시를 '재구성한 헤더'로 계산하는데, 그 길이가 파일의 SizeOfHeaders 와
 * 다른 실행 파일이 있다(Electron 본체가 그렇다). 그대로 두면 Windows 가 거부하는 서명이 된다.
 * 그래서 규격대로 파일에서 직접 계산한 해시를 넣는 2단계 방식을 쓴다.
 *   1단계: 아무 해시로 한 번 서명해 최종 배치(패딩·인증서 위치)를 알아낸다
 *   2단계: 그 결과 파일로 올바른 해시를 계산해 다시 서명한다 (배치가 같으므로 해시가 유효하다)
 * 마지막에 스스로 검증하고, 어긋나면 파일을 쓰지 않는다.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { NtExecutable, generateExecutableWithSign } = require('resedit');

const ROOT = path.join(__dirname, '..');
const KEY = path.join(ROOT, 'certs', 'codesign.key');
const CER = path.join(ROOT, 'certs', 'codesign.cer');

/* ---------- PE 들여다보기 ---------- */

function peInfo(buf) {
  const pe = buf.readUInt32LE(0x3c);
  const isPE32Plus = buf.readUInt16LE(pe + 24) === 0x20b;
  const dirOffset = pe + 24 + (isPE32Plus ? 112 : 96);
  const certEntry = dirOffset + 8 * 4; // ImageDirectoryEntry.Certificate
  const sectionCount = buf.readUInt16LE(pe + 6);
  const firstSection = pe + 24 + buf.readUInt16LE(pe + 20);
  const sections = [];
  for (let i = 0; i < sectionCount; i++) {
    const o = firstSection + i * 40;
    sections.push({ ptr: buf.readUInt32LE(o + 20), size: buf.readUInt32LE(o + 16) });
  }
  sections.sort((a, b) => a.ptr - b.ptr);
  return {
    checkSumOffset: pe + 88,
    certEntry,
    sizeOfHeaders: buf.readUInt32LE(pe + 24 + 60),
    sections,
    certOffset: buf.readUInt32LE(certEntry),
    certSize: buf.readUInt32LE(certEntry + 4),
    endOfSections: sections.reduce((m, s) => Math.max(m, s.ptr + s.size), 0),
  };
}

/**
 * Authenticode 규격대로 파일에서 PE 해시를 계산한다.
 * 체크섬(4바이트), 인증서 테이블 항목(8바이트), 그리고 인증서 블록 자체는 제외한다.
 */
function authenticodeHash(buf, algorithm = 'sha256') {
  const info = peInfo(buf);
  const h = crypto.createHash(algorithm);
  h.update(buf.subarray(0, info.checkSumOffset));
  h.update(buf.subarray(info.checkSumOffset + 4, info.certEntry));
  h.update(buf.subarray(info.certEntry + 8, info.sizeOfHeaders));
  for (const s of info.sections) if (s.size > 0) h.update(buf.subarray(s.ptr, s.ptr + s.size));
  const extraEnd = info.certSize ? info.certOffset : buf.length;
  if (extraEnd > info.endOfSections) {
    const extra = buf.subarray(info.endOfSections, extraEnd);
    h.update(extra);
    const pad = (8 - (extra.length % 8)) % 8;
    if (pad) h.update(Buffer.alloc(pad));
  }
  return h.digest();
}

/* ---------- 서명 ---------- */

function readAll(iterator) {
  const chunks = [];
  for (;;) {
    const r = iterator.next();
    if (r.done) break;
    chunks.push(Buffer.from(r.value));
  }
  return Buffer.concat(chunks);
}

/**
 * @param overrideDigest 첫 번째 digestData 호출(=PE 해시)에 쓸 값. 나머지 호출은 정상 계산한다.
 */
function makeSigner(overrideDigest) {
  const privateKey = fs.readFileSync(KEY, 'utf8');
  const cert = fs.readFileSync(CER);
  let firstCall = true;
  return {
    getDigestAlgorithm: () => 'sha256',
    getEncryptionAlgorithm: () => 'rsa',
    getCertificateData: () => cert,
    digestData: (it) => {
      const data = readAll(it); // 넘겨준 자료는 모두 읽어야 한다
      if (firstCall) {
        firstCall = false;
        return Promise.resolve(overrideDigest);
      }
      return Promise.resolve(crypto.createHash('sha256').update(data).digest());
    },
    signData: (it) => Promise.resolve(crypto.sign('sha256', readAll(it), privateKey)),
  };
}

async function signOnce(source, digest) {
  const exe = NtExecutable.from(source, { ignoreCert: true });
  return Buffer.from(await generateExecutableWithSign(exe, makeSigner(digest)));
}

async function sign(exePath) {
  if (!fs.existsSync(KEY) || !fs.existsSync(CER)) {
    console.log('  • 인증서 없음     서명을 건너뜁니다 (node scripts/make-cert.js)');
    return false;
  }
  const original = fs.readFileSync(exePath);
  const overlayStart = peInfo(original).endOfSections;
  const overlayBefore = original.subarray(overlayStart);

  // 1단계: 배치 파악용
  const draft = await signOnce(original, Buffer.alloc(32));
  // 2단계: 규격대로 계산한 해시로 다시
  const digest = authenticodeHash(draft);
  const signed = await signOnce(original, digest);

  /* --- 검증: 어긋나면 쓰지 않는다 --- */
  if (signed.length !== draft.length) {
    throw new Error(`${path.basename(exePath)}: 두 번째 서명에서 배치가 달라졌습니다`);
  }
  const info = peInfo(signed);
  if (!info.certSize) throw new Error(`${path.basename(exePath)}: 서명이 기록되지 않았습니다`);

  const recomputed = authenticodeHash(signed);
  if (!recomputed.equals(digest)) {
    throw new Error(`${path.basename(exePath)}: 서명한 파일의 해시가 달라졌습니다`);
  }
  const blob = signed.subarray(info.certOffset, info.certOffset + info.certSize);
  if (!blob.includes(digest)) {
    throw new Error(`${path.basename(exePath)}: 서명 안의 해시가 파일과 맞지 않습니다`);
  }
  // 덧붙임 데이터(NSIS 자기추출 자료)가 그대로인지. 뒤쪽 정렬 패딩은 빼고 견준다.
  const after = signed.subarray(info.endOfSections, info.endOfSections + overlayBefore.length);
  if (!after.equals(overlayBefore)) {
    throw new Error(`${path.basename(exePath)}: 덧붙임 데이터가 보존되지 않았습니다`);
  }

  fs.writeFileSync(exePath, signed);
  console.log(
    `  • signed         ${path.relative(ROOT, exePath)}` +
    ` (서명 ${info.certSize}바이트${overlayBefore.length ? `, 덧붙임 자료 ${overlayBefore.length}바이트 보존` : ''})`
  );
  return true;
}

module.exports = { sign, authenticodeHash, peInfo };

if (require.main === module) {
  const target = process.argv[2];
  if (!target) {
    console.error('사용법: node scripts/sign-exe.js <exe 경로>');
    process.exit(1);
  }
  sign(path.resolve(target)).catch((err) => {
    console.error('서명 실패:', err.message);
    process.exit(1);
  });
}
