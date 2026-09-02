import { execFileSync } from 'node:child_process';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    // Extensionless base path; packager appends .icns (macOS) / .ico (Windows).
    icon: 'assets/icon',
    // Lowercase binary name: the Linux deb/rpm makers look for this exact name
    // (else "could not find the Electron app binary at .../dombot"), and it's the
    // conventional CLI/launcher name on every platform. On macOS it also lowercases
    // the Info.plist display name to "dombot" — the postPackage hook restores it.
    executableName: 'dombot',
  },
  rebuildConfig: {},
  hooks: {
    // macOS post-package fixups, run after Packager finishes and before the makers
    // zip/dmg the bundle:
    //  1. Restore the user-facing name to "DomBot" — executableName lowercased
    //     CFBundleDisplayName to "dombot" (shown in Finder, the menu bar, and the
    //     Gatekeeper dialog).
    //  2. Deep ad-hoc re-sign the bundle. Flipping fuses and Packager's Info.plist
    //     edits invalidate the stock Electron signature, so macOS rejects the app
    //     as "damaged"; re-signing here (after the plist edit above, so the seal
    //     covers it) restores a valid signature and users get the ordinary
    //     "unidentified developer" prompt instead. Replace with Developer ID
    //     signing + notarization to remove the prompt entirely.
    postPackage: async (_forgeConfig, { platform, outputPaths }) => {
      if (platform !== 'darwin') return;
      for (const outputPath of outputPaths) {
        const app = `${outputPath}/DomBot.app`;
        execFileSync(
          '/usr/libexec/PlistBuddy',
          ['-c', 'Set :CFBundleDisplayName DomBot', `${app}/Contents/Info.plist`],
          { stdio: 'inherit' },
        );
        execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], {
          stdio: 'inherit',
        });
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
