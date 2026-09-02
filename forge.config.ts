import { execFileSync } from 'node:child_process';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

// Real Developer ID signing + notarization run only when the Apple credentials
// are present in the environment (set from GitHub secrets in CI — see
// .github/workflows/release.yml and README → macOS code signing). Without them
// (local dev, PRs, forks) the macOS build falls back to the ad-hoc re-sign in the
// postPackage hook below, which runs but shows an "unidentified developer" prompt.
const APPLE_SIGNING_IDENTITY = process.env.APPLE_SIGNING_IDENTITY;
const notarizeMac = Boolean(APPLE_SIGNING_IDENTITY);

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    // Extensionless base path; packager appends .icns (macOS) / .ico (Windows).
    icon: 'assets/icon',
    // Lowercase the binary ONLY on Linux, where the deb/rpm makers require it
    // (else "could not find the Electron app binary at .../dombot"). macOS and
    // Windows keep "DomBot" so the user-facing name (Finder, menu bar, Gatekeeper,
    // taskbar) is correctly cased — and so nothing has to rewrite Info.plist after
    // signing, which would break the Developer ID signature.
    executableName: process.platform === 'linux' ? 'dombot' : undefined,
    // Developer ID signing (macOS). Hardened runtime is required for notarization;
    // @electron/osx-sign applies Electron-appropriate default entitlements.
    osxSign: notarizeMac
      ? { identity: APPLE_SIGNING_IDENTITY, optionsForFile: () => ({ hardenedRuntime: true }) }
      : undefined,
    // Notarization via App Store Connect API key (set from secrets).
    osxNotarize: notarizeMac
      ? {
          appleApiKey: process.env.APPLE_API_KEY_PATH as string,
          appleApiKeyId: process.env.APPLE_API_KEY_ID as string,
          appleApiIssuer: process.env.APPLE_API_ISSUER as string,
        }
      : undefined,
  },
  rebuildConfig: {},
  hooks: {
    // macOS, after Packager finishes and before the makers zip/dmg the bundle:
    //  - Signed path (osxSign/osxNotarize ran during packaging): staple the
    //    notarization ticket to the app so it validates offline.
    //  - Ad-hoc path (local/dev/PR): deep ad-hoc re-sign. Flipping fuses and
    //    Packager's Info.plist edits invalidate the stock Electron signature, so
    //    macOS would reject the app as "damaged"; re-signing restores a valid
    //    signature (users then get the ordinary "unidentified developer" prompt).
    postPackage: async (_forgeConfig, { platform, outputPaths }) => {
      if (platform !== 'darwin') return;
      for (const outputPath of outputPaths) {
        const app = `${outputPath}/DomBot.app`;
        if (notarizeMac) {
          execFileSync('xcrun', ['stapler', 'staple', app], { stdio: 'inherit' });
        } else {
          execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], {
            stdio: 'inherit',
          });
        }
      }
    },
  },
  makers: [
    new MakerSquirrel({
      setupIcon: 'assets/icon.ico',
    }),
    // macOS ships a .zip here; the downloadable .dmg is assembled from the
    // packaged .app in CI with hdiutil (see .github/workflows/release.yml) to
    // avoid maker-dmg's fragile native `appdmg` dependency.
    new MakerZIP({}, ['darwin']),
    new MakerRpm({
      options: {
        icon: 'assets/icon.png',
      },
    }),
    new MakerDeb({
      options: {
        icon: 'assets/icon.png',
      },
    }),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
