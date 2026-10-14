#!/usr/bin/env bash
set -euo pipefail
export ANDROID_HOME=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-"$HOME/.cache/tgh-android-sdk"}}
export JAVA_HOME=${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}
export NODE_ENV=production
export NODE_OPTIONS=--max-old-space-size=384
export CMAKE_BUILD_PARALLEL_LEVEL=1
export JAVA_TOOL_OPTIONS='-XX:ActiveProcessorCount=1 -XX:+UseSerialGC'
mobile_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$mobile_dir/android"
stage=${1:?Specify bundle, configure, native, compile, dex or package}
heap=${TGH_GRADLE_HEAP:-768}
if [[ "$stage" == bundle || "$stage" == configure ]]; then heap=512; fi
args=(-PreactNativeArchitectures=arm64-v8a -Pexpo.useLegacyPackaging=true
  -Pkotlin.compiler.execution.strategy=in-process
  "-Dorg.gradle.jvmargs=-Xmx${heap}m -XX:MaxMetaspaceSize=384m -XX:ActiveProcessorCount=1 -XX:+UseSerialGC"
  -Dorg.gradle.parallel=false --max-workers=1 --no-daemon --console=plain
  --init-script "$mobile_dir/scripts/android-resource-limits.gradle")
case "$stage" in
  bundle) ./gradlew :app:createBundleReleaseJsAndAssets "${args[@]}" ;;
  configure) ./gradlew ':app:configureCMakeRelWithDebInfo[arm64-v8a]' "${args[@]}" ;;
  native)
    for file in app/.cxx/RelWithDebInfo/*/arm64-v8a/build.ninja; do
      "$ANDROID_HOME/cmake/3.22.1/bin/ninja" -C "${file%/build.ninja}" -j1 appmodules
    done ;;
  native-deps)
    for file in ../node_modules/react-native-{gesture-handler,worklets,reanimated,screens}/android/.cxx/RelWithDebInfo/*/arm64-v8a/build.ninja; do
      "$ANDROID_HOME/cmake/3.22.1/bin/ninja" -C "${file%/build.ninja}" -j1
    done ;;
  compile) ./gradlew :app:compileReleaseKotlin :app:compileReleaseJavaWithJavac "${args[@]}" ;;
  dex) ./gradlew :app:mergeExtDexRelease :app:mergeDexRelease "${args[@]}" ;;
  package) ./gradlew :app:assembleRelease "${args[@]}" ;;
  *) exit 2 ;;
esac
