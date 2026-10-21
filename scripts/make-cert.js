'use strict';
/**
 * 코드 서명용 자체 서명 인증서를 만든다 (openssl 필요, 없으면 건너뛴다).
 *
 * 이 인증서는 공인 기관이 발급한 것이 아니라서, 인증서를 신뢰 목록에 넣은 컴퓨터에서만
 * '게시자를 확인할 수 없습니다' 경고가 사라진다. 설치 방법은 README 참고.
 *
 * 한 번 만든 키는 계속 써야 한다. 새로 만들면 이미 신뢰해 둔 인증서와 달라져서
 * 경고가 다시 뜬다. (그래서 이미 있으면 새로 만들지 않는다)
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CERT_DIR = path.join(__dirname, '..', 'certs');
const KEY = path.join(CERT_DIR, 'codesign.key');
const CRT = path.join(CERT_DIR, 'codesign.crt'); // PEM
const CER = path.join(CERT_DIR, 'codesign.cer'); // DER, Windows 에서 가져오기 편한 형식
const SUBJECT = '/CN=Warn & Alarm/O=Warn & Alarm/C=KR';

function has(cmd) {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

function main() {
  if (fs.existsSync(KEY) && fs.existsSync(CER)) {
    console.log('  • 인증서 있음     certs/codesign.cer (그대로 사용)');
    return;
  }
  if (!has('openssl')) {
    console.log('  • openssl 없음    서명을 건너뜁니다');
    return;
  }
  fs.mkdirSync(CERT_DIR, { recursive: true });
  const conf = path.join(CERT_DIR, 'openssl.cnf');
  fs.writeFileSync(conf, [
    '[req]',
    'distinguished_name = dn',
    'x509_extensions = v3',
    'prompt = no',
    '[dn]',
    'CN = Warn & Alarm',
    'O = Warn & Alarm',
    'C = KR',
    '[v3]',
    'basicConstraints = critical, CA:false',
    'keyUsage = critical, digitalSignature',
    'extendedKeyUsage = critical, codeSigning',   // 코드 서명 전용
    'subjectKeyIdentifier = hash',
  ].join('\n'));

  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:3072', '-sha256',
    '-days', '3650', '-nodes',
    '-keyout', KEY, '-out', CRT,
    '-subj', SUBJECT, '-config', conf, '-extensions', 'v3',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  execFileSync('openssl', ['x509', '-in', CRT, '-outform', 'der', '-out', CER]);
  fs.rmSync(conf, { force: true });
  console.log('  • 인증서 생성     certs/codesign.cer (10년)');
}

main();
module.exports = { KEY, CRT, CER };
