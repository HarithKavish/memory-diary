#!/usr/bin/env python3
import sys
import os


def validate_gradle_file_path(gradle_file_path):
    """Ensure the gradle file path is within the repository and safe to modify."""
    # Convert to absolute path
    abs_path = os.path.abspath(gradle_file_path)
    # Get the current working directory (should be the app directory when called from workflow)
    cwd = os.getcwd()
    # Ensure the absolute path is inside the current working directory or its subdirectories
    try:
        rel_path = os.path.relpath(abs_path, start=cwd)
        # If rel_path starts with '..', it's trying to escape
        if rel_path.startswith('..'):
            print(f"::error::Path traversal attempt detected: {gradle_file_path}")
            sys.exit(1)
    except ValueError:
        # If the paths are on different drives (Windows) or other issues, reject
        print(f"::error::Path is not within the current working directory: {gradle_file_path}")
        sys.exit(1)
    # Additionally, we can check that the file extension is .kts or .gradle
    if not (abs_path.endswith('.kts') or abs_path.endswith('.gradle')):
        print(f"::warning::Expected a Gradle script file (.kts or .gradle), got: {gradle_file_path}")
    return abs_path


def patch_gradle_file(gradle_file_path):
    """Patch the build.gradle.kts file to add release signing config."""
    # Validate the path first
    gradle_file_path = validate_gradle_file_path(gradle_file_path)
    if not os.path.exists(gradle_file_path):
        print(f"::error::File not found: {gradle_file_path}")
        sys.exit(1)

    with open(gradle_file_path, 'r') as f:
        content = f.read()

    # Step 1: Ensure signingConfigs block exists after 'android {'
    android_pos = content.find('android {')
    if android_pos == -1:
        print(f"::error::Could not find 'android {{' in {gradle_file_path}")
        sys.exit(1)

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
    # If the signingConfigs block is not already present, insert it.
    if 'signingConfigs {' not in content:
        content = content[:insert_pos] + signing_configs_block + content[insert_pos:]
    # If it is already present, we leave it as is to avoid breaking custom configs.

    # Step 2: Replace the release buildType block inside buildTypes
    build_types_pos = content.find('buildTypes {')
    if build_types_pos == -1:
        print(f"::error::Could not find 'buildTypes {{' in {gradle_file_path}")
        sys.exit(1)

    release_pos = content.find('release {', build_types_pos)
    if release_pos == -1:
        print(f"::error::Could not find 'release {{' in buildTypes block in {gradle_file_path}")
        sys.exit(1)

    # Find the matching closing brace for the release block using brace counting
    brace_count = 1  # Start with 1 for the opening brace we found
    pos = release_pos + 7  # Position after 'release {'

    while pos < len(content) and brace_count > 0:
        char = content[pos]
        if char == '{':
            brace_count += 1
        elif char == '}':
            brace_count -= 1
        pos += 1

    if brace_count != 0:
        print(f"::error::Could not find matching closing brace for release block in {gradle_file_path}")
        sys.exit(1)

    # pos is now at the character after the matching '}'
    end_pos = pos

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

    # Verification: re-read the file and check that the release block contains our intended logic
    with open(gradle_file_path, 'r') as f:
        verified_content = f.read()

    # Check that the release block has our conditional signing config
    if 'signingConfigs.getByName("release")' not in verified_content:
        print(f"::error::Verification failed: release signing config not found in {gradle_file_path}")
        sys.exit(1)

    if 'signingConfigs.getByName("debug")' not in verified_content:
        print(f"::error::Verification failed: debug signing config not found in {gradle_file_path}")
        sys.exit(1)

    # Also verify that signingConfigs block exists and contains the release config
    if 'signingConfigs {' not in verified_content:
        print(f"::error::Verification failed: signingConfigs block not found in {gradle_file_path}")
        sys.exit(1)

    if 'create("release")' not in verified_content:
        print(f"::error::Verification failed: create(\\\"release\\\") not found in {gradle_file_path}")
        sys.exit(1)

    print("Patch applied successfully")


if __name__ == '__main__':
    if len(sys.argv) != 2:
        print("Usage: python3 patch_gradle.py <path-to-build.gradle.kts>")
        sys.exit(1)

    # Check if we have the keystore environment variables set (the four secrets)
    required_env = ["ANDROID_KEYSTORE_BASE64", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD"]
    if all(os.environ.get(var) for var in required_env):
        print("Patch: All signing secrets are set, configuring release signingConfig")
        patch_gradle_file(sys.argv[1])
    else:
        print("Patch: Not all signing secrets are set, leaving debug signingConfig (for local development)")
