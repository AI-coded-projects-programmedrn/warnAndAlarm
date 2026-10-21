'use strict';
/**
 * Windows 실행 파일에 아이콘과 버전 정보를 넣는다.
 * electron-builder 는 이 작업에 rcedit(=wine)을 쓰지만, 여기서는 순수 JS 라이브러리를 쓴다.
 * electron-builder 의 afterPack 훅에서 호출된다. (직접 실행도 가능: node scripts/brand-exe.js <exe 경로>)
 */
const fs = require('fs');
const path = require('path');
const { NtExecutable, NtExecutableResource, Resource, Data } = require('resedit');
const { sign } = require('./sign-exe');

const ROOT = path.join(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));

function toVersionTuple(v) {
  const parts = String(v).split('.').map((n) => parseInt(n, 10) || 0);
  while (parts.length < 4) parts.push(0);
  return parts.slice(0, 4);
}

function brand(exePath, icoPath) {
  const exe = NtExecutable.from(fs.readFileSync(exePath));
  const res = NtExecutableResource.from(exe);

  // 아이콘 (기존 아이콘 그룹 1번을 교체)
  const icon = Data.IconFile.from(fs.readFileSync(icoPath));
  Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    1,
    1033, // en-US
    icon.icons.map((i) => i.data)
  );

  // 버전 정보
  const vi = Resource.VersionInfo.createEmpty();
  const [ma, mi, pa, bu] = toVersionTuple(pkg.version);
  vi.setFileVersion(ma, mi, pa, bu, 1033);
  vi.setProductVersion(ma, mi, pa, bu, 1033);
  vi.setStringValues(
    { lang: 1033, codepage: 1200 },
    {
      ProductName: pkg.build.productName || pkg.productName || pkg.name,
      FileDescription: pkg.description || pkg.productName || pkg.name,
      CompanyName: pkg.author || '',
      LegalCopyright: `Copyright (C) ${new Date().getFullYear()} ${pkg.author || ''}`.trim(),
      OriginalFilename: path.basename(exePath),
      InternalName: pkg.name,
    }
  );
  vi.outputToResourceEntries(res.entries);

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log(`  • branded        ${path.relative(ROOT, exePath)} (icon + version info, no wine)`);
}

/** electron-builder afterPack 훅: 아이콘·버전 정보를 넣고 서명한다 */
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exePath = path.join(context.appOutDir, exeName);
  brand(exePath, path.join(ROOT, 'build', 'icon.ico'));
  await sign(exePath);
};

if (require.main === module) {
  const target = process.argv[2];
  if (!target) {
    console.error('사용법: node scripts/brand-exe.js <exe 경로>');
    process.exit(1);
  }
  brand(path.resolve(target), path.join(ROOT, 'build', 'icon.ico'));
}
