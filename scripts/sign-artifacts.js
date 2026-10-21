'use strict';
/**
 * electron-builder afterAllArtifactBuild 훅.
 * 완성된 .exe 결과물(포터블 자기추출 파일 등)에 서명을 넣는다.
 * (앱 본체 실행 파일은 afterPack 단계에서 이미 서명된다)
 */
const path = require('path');
const { sign } = require('./sign-exe');

module.exports = async function afterAllArtifactBuild(buildResult) {
  for (const file of buildResult.artifactPaths) {
    if (path.extname(file).toLowerCase() !== '.exe') continue;
    await sign(file);
  }
  return [];
};
