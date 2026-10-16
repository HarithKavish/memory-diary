#!/usr/bin/env python3
"""Patch the flutter-generated build.gradle.kts to add release signing config.

Called by .github/workflows/build-apk.yml from the app/ directory, where the
generated Gradle file is always at android/app/build.gradle.kts — the path is
fixed by the workflow, never taken from the command line, so a tainted or
mistyped argument cannot redirect the patch at an arbitrary file (Sonar
pythonsecurity:S8707).
"""
import os
import sys

# Fixed by the calling workflow (working-directory: app): the file that
# `flutter create --platforms=android` regenerates on every build.
GRADLE_FILE = os.path.join("android", "app", "build.gradle.kts")


def patch_gradle_file(gradle_file_path):
    """Patch the build.gradle.kts file to add release signing config."""
    if not os.path.exists(gradle_file_path):
        print(f"File not found: {gradle_file_path}")
        sys.exit(1)

    with open(gradle_file_path, 'r') as f:
        content = f.read()

    # Anchor text we expect in the release buildType
    ANCHOR = '// TODO: Add your own signing config for the release build.'
    if ANCHOR not in content:
        print(f"::error::Anchor text not found in {gradle_file_path}: {ANCHOR}")
        print("::error::Template drift detected. Aborting to avoid shipping debug-signed APK.")
        sys.exit(1)

    # Step 1: Insert signingConfigs block after 'android {'
    # Find the position of 'android {' and insert after it
    android_pos = content.find('android {')
    if android_pos == -1:
        print(f"::error::Could not find 'android {{' in {gradle_file_path}")
        sys.exit(1)

    # Find the end of the 'android {' line (position after the newline)
    insert_pos = content.find('\n', android_pos) + 1

    signing_configs_block = '''    signingConfigs {
        create("release") {
            if (System.getenv("ANDROID_KEYSTORE_BASE64") != null) {
                storeFile = file(System.getenv("RUNNER_TEMP") + "/release.jks")
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }
'''

    content = content[:insert_pos] + signing_configs_block + content[insert_pos:]

    # Step 2: Replace the release buildType block inside buildTypes
    # Find 'buildTypes {' first
    build_types_pos = content.find('buildTypes {')
    if build_types_pos == -1:
        print(f"::error::Could not find 'buildTypes {{' in {gradle_file_path}")
        sys.exit(1)

    # Find the 'release {' after buildTypes {
    release_pos = content.find('release {', build_types_pos)
    if release_pos == -1:
        print(f"::error::Could not find 'release {{' in buildTypes block in {gradle_file_path}")
        sys.exit(1)

    # Find the closing brace of the release block (the next '}' at the same indentation level)
    # We'll look for the pattern: '        }' (8 spaces + }) after the release block
    # The original block is 4 lines:
    #         release {
    #             // TODO: Add your own signing config for the release build.
    #             // Signing with the debug keys for now, so `flutter run --release` works.
    #             signingConfig = signingConfigs.getByName("debug")
    #         }
    # We want to replace from 'release {' to the '        }' line

    # Find the next '        }' after release_pos (8 spaces + })
    end_pos = content.find('        }', release_pos)
    if end_pos == -1:
        print(f"::error::Could not find closing brace of release block in {gradle_file_path}")
        sys.exit(1)

    # Include the newline after the closing brace
    end_pos = content.find('\n', end_pos) + 1

    new_release_block = '''        release {
            if (System.getenv("ANDROID_KEYSTORE_BASE64") != null) {
                signingConfig = signingConfigs.getByName("release")
            } else {
                signingConfig = signingConfigs.getByName("debug")
            }
        }
'''

    content = content[:release_pos] + new_release_block + content[end_pos:]

    # Write back
    with open(gradle_file_path, 'w') as f:
        f.write(content)

    print("Patch applied successfully")


if __name__ == '__main__':
    if len(sys.argv) != 1:
        print(f"Usage: python3 {sys.argv[0]}")
        print("The Gradle file path is fixed by the calling workflow; arguments are not accepted.")
        sys.exit(1)

    # Check if we have the keystore environment variables set (the four secrets)
    required_env = ["ANDROID_KEYSTORE_BASE64", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD"]
    if all(os.environ.get(var) for var in required_env):
        print("Patch: All signing secrets are set, configuring release signingConfig")
        patch_gradle_file(GRADLE_FILE)
    else:
        print("Patch: Not all signing secrets are set, leaving debug signingConfig (for local development)")
