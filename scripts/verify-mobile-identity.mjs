import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const read = (relativePath) => readFile(resolve(root, relativePath), "utf8");
const identity = JSON.parse(await read("mobile/app-identity.json"));
const failures = [];
const requireMatch = (condition, message) => {
  if (!condition) failures.push(message);
};
const escapeRegExp = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const [
  packageJson,
  packageLock,
  capacitor,
  androidGradle,
  androidManifest,
  androidStrings,
  androidFilePaths,
  gradleWrapper,
  iosInfo,
  iosProject,
  iosEntitlements,
  aasaTemplate,
  privacyManifest,
  nvmrc,
] = await Promise.all([
  read("package.json"),
  read("package-lock.json"),
  read("capacitor.config.json"),
  read("android/app/build.gradle"),
  read("android/app/src/main/AndroidManifest.xml"),
  read("android/app/src/main/res/values/strings.xml"),
  read("android/app/src/main/res/xml/file_paths.xml"),
  read("android/gradle/wrapper/gradle-wrapper.properties"),
  read("ios/App/App/Info.plist"),
  read("ios/App/App.xcodeproj/project.pbxproj"),
  read("ios/App/App/App.entitlements"),
  read("mobile/deep-links/apple-app-site-association.template.json"),
  read("ios/App/App/PrivacyInfo.xcprivacy"),
  read(".nvmrc"),
]);
const pkg = JSON.parse(packageJson);
const lock = JSON.parse(packageLock);
const cap = JSON.parse(capacitor);
const aasa = JSON.parse(aasaTemplate);

requireMatch(pkg.version === identity.versionName, "package version drift");
requireMatch(
  lock.packages?.[""]?.version === identity.versionName,
  "package-lock version drift",
);
requireMatch(
  pkg.engines?.node === ">=22.12.0",
  "Node engine must be pinned to >=22.12.0",
);
requireMatch(nvmrc.trim() === "22.22.0", ".nvmrc version drift");
requireMatch(cap.appId === identity.appId, "Capacitor appId drift");
requireMatch(cap.appName === identity.appName, "Capacitor appName drift");
requireMatch(
  new RegExp(
    `applicationId\\s*=\\s*"${escapeRegExp(identity.appId)}"`,
  ).test(androidGradle) &&
    new RegExp(`versionCode\\s*=\\s*${identity.versionCode}\\b`).test(
      androidGradle,
    ) &&
    new RegExp(
      `versionName\\s*=\\s*"${escapeRegExp(identity.versionName)}"`,
    ).test(androidGradle),
  "Android identity/version drift",
);
requireMatch(
  androidStrings.includes(`<string name="package_name">${identity.appId}</string>`) &&
    androidStrings.includes(
      `<string name="custom_url_scheme">${identity.customScheme}</string>`,
    ),
  "Android string identity drift",
);
requireMatch(
  iosProject.match(
    new RegExp(
      `PRODUCT_BUNDLE_IDENTIFIER = ${escapeRegExp(identity.appId)};`,
      "g",
    ),
  )?.length === 2 &&
    iosProject.match(
      new RegExp(`MARKETING_VERSION = ${escapeRegExp(identity.versionName)};`, "g"),
    )?.length === 2 &&
    iosProject.match(
      new RegExp(`CURRENT_PROJECT_VERSION = ${identity.versionCode};`, "g"),
    )?.length === 2,
  "iOS identity/version drift",
);
requireMatch(
  iosInfo.includes(`<string>${identity.customScheme}</string>`) &&
    !iosInfo.includes("<string>vinifera</string>"),
  "iOS custom scheme must be the single canonical scheme",
);
requireMatch(
  iosEntitlements.includes(
    `<string>applinks:${identity.universalLinkHost}</string>`,
  ),
  "iOS associated-domain drift",
);
requireMatch(
  iosEntitlements.includes("<string>$(APNS_ENTITLEMENT_ENVIRONMENT)</string>") &&
    iosProject.includes("APNS_ENTITLEMENT_ENVIRONMENT = development;") &&
    iosProject.includes("APNS_ENTITLEMENT_ENVIRONMENT = production;"),
  "iOS APNs entitlement environment is not configuration-bound",
);
requireMatch(
  androidManifest.includes(`android:scheme="${identity.customScheme}"`) &&
    !androidManifest.includes('android:scheme="vinifera"') &&
    androidManifest.includes(`android:host="${identity.universalLinkHost}"`) &&
    !androidManifest.includes("android:pathPrefix"),
  "Android deep-link identity drift",
);
for (const path of identity.externalDeepLinkPaths) {
  requireMatch(
    androidManifest.includes(`android:path="${path}"`),
    `Android is missing exact deep-link path ${path}`,
  );
}
const templatePaths = (aasa.applinks?.details?.[0]?.components ?? []).map(
  (component) => component["/"],
);
requireMatch(
  JSON.stringify(templatePaths) ===
    JSON.stringify(identity.externalDeepLinkPaths),
  "AASA template path allowlist drift",
);
requireMatch(
  JSON.stringify(aasa.applinks?.details?.[0]?.appIDs) ===
    JSON.stringify([
      `\${MOBILE_APPLE_TEAM_ID}.${identity.appId}`,
    ]),
  "AASA template app identity drift",
);
requireMatch(
  !("apps" in aasa.applinks) &&
    !("appID" in aasa.applinks.details[0]) &&
    !("paths" in aasa.applinks.details[0]),
  "AASA template contains a legacy association shape",
);
requireMatch(
  gradleWrapper.includes(
    "distributionSha256Sum=ed1a8d686605fd7c23bdf62c7fc7add1c5b23b2bbc3721e661934ef4a4911d7c",
  ),
  "Gradle distribution checksum is not pinned",
);
requireMatch(
  /minifyEnabled\s*=\s*true/.test(androidGradle) &&
    /shrinkResources\s*=\s*true/.test(androidGradle) &&
    androidGradle.includes("proguard-android-optimize.txt"),
  "Android Release R8 hardening drift",
);
requireMatch(
  !androidFilePaths.includes("<external-path") &&
    !androidFilePaths.includes('path="."') &&
    androidFilePaths.includes('path="exports/"'),
  "Android FileProvider scope is broader than internal exports",
);
requireMatch(
  privacyManifest.includes("NSPrivacyCollectedDataTypeEmailAddress") &&
    privacyManifest.includes("NSPrivacyCollectedDataTypeDeviceID") &&
    privacyManifest.includes("<false/>"),
  "iOS privacy manifest inventory is incomplete",
);

const defaultCapacitorIcon =
  "29e4777e319de3ee5a52c3a8004ec19d0568414004257e36d7c94a077d71c93b";
const icon = await readFile(
  resolve(
    root,
    "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png",
  ),
);
const androidIcon = await readFile(
  resolve(root, "android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png"),
);
requireMatch(
  createHash("sha256").update(icon).digest("hex") !== defaultCapacitorIcon,
  "default Capacitor app icon is still present",
);
requireMatch(
  createHash("sha256").update(androidIcon).digest("hex") !==
    "87cb2f2ffe992652bb4fa768c73719a37b5852ab17fbf8e170e888f7a42b0761",
  "default Capacitor Android icon is still present",
);
requireMatch(
  (await sharp(icon).metadata()).hasAlpha === false,
  "iOS App Store icon must not contain an alpha channel",
);

if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Mobile identity verified: ${identity.appId} ${identity.versionName} (${identity.versionCode}).`,
  );
}
