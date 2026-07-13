#!/usr/bin/env node
// ============================================================================
// VERSION UPDATE SCRIPT (for public nokakoi repo)
// ============================================================================
// Updates version numbers in all files from js/version.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const VERSION_PATTERNS = [
  /export\s+const\s+VERSION\s*=\s*['"]([^'"]+)['"]/,
  /const\s+VERSION\s*=\s*['"]([^'"]+)['"]/,
];

function readVersion() {
  const versionFile = path.join(ROOT, 'js/version.js');
  if (!fs.existsSync(versionFile)) {
    throw new Error(`version.js not found: ${versionFile}`);
  }

  const versionContent = fs.readFileSync(versionFile, 'utf8');
  for (const pattern of VERSION_PATTERNS) {
    const match = versionContent.match(pattern);
    if (match) return match[1];
  }

  throw new Error(
    'Could not find VERSION in js/version.js\n' +
    'Expected: export const VERSION = \'1.2.3\';'
  );
}

function replaceAll(content, pattern, replacement, label) {
  if (!pattern.test(content)) {
    throw new Error(`Could not find ${label} (pattern: ${pattern})`);
  }
  return content.replace(pattern, replacement);
}

function updateIndexHtml(version) {
  const indexPath = path.join(ROOT, 'index.html');
  let indexHtml = fs.readFileSync(indexPath, 'utf8');

  indexHtml = replaceAll(
    indexHtml,
    /style\.css\?v=[0-9.]+/g,
    `style.css?v=${version}`,
    'style.css?v= in index.html'
  );
  indexHtml = replaceAll(
    indexHtml,
    /main\.js\?v=[0-9.]+/g,
    `main.js?v=${version}`,
    'main.js?v= in index.html'
  );

  fs.writeFileSync(indexPath, indexHtml);
}

function updateSwJs(version) {
  const swPath = path.join(ROOT, 'sw.js');
  let swContent = fs.readFileSync(swPath, 'utf8');

  const cachePatterns = [
    {
      pattern: /const CACHE_VERSION = 'v[0-9.]+'/g,
      replacement: `const CACHE_VERSION = 'v${version}'`,
    },
    {
      pattern: /const CACHE_VERSION = "v[0-9.]+"/g,
      replacement: `const CACHE_VERSION = "v${version}"`,
    },
  ];

  let updated = false;
  for (const { pattern, replacement } of cachePatterns) {
    if (pattern.test(swContent)) {
      swContent = swContent.replace(pattern, replacement);
      updated = true;
      break;
    }
  }

  if (!updated) {
    throw new Error(
      'Could not find CACHE_VERSION in sw.js\n' +
      "Expected: const CACHE_VERSION = 'v1.2.3';"
    );
  }

  fs.writeFileSync(swPath, swContent);
}

function updatePackageJson(version) {
  const packagePath = path.join(ROOT, 'package.json');
  let packageJson;

  try {
    packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse package.json: ${err.message}`);
  }

  if (packageJson.version !== version) {
    packageJson.version = version;
    fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + '\n');
  }
}

function updatePackageLockJson(version) {
  const lockPath = path.join(ROOT, 'package-lock.json');
  if (!fs.existsSync(lockPath)) {
    console.log('package-lock.json not found, skipping');
    return;
  }

  let packageLock;
  try {
    packageLock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse package-lock.json: ${err.message}`);
  }

  let changed = false;
  if (packageLock.version !== version) {
    packageLock.version = version;
    changed = true;
  }
  if (packageLock.packages && packageLock.packages['']) {
    if (packageLock.packages[''].version !== version) {
      packageLock.packages[''].version = version;
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(lockPath, JSON.stringify(packageLock, null, 2) + '\n');
  }
}

function verifySync(version) {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const swContent = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

  const issues = [];
  if (!indexHtml.includes(`style.css?v=${version}`)) {
    issues.push(`index.html missing style.css?v=${version}`);
  }
  if (!indexHtml.includes(`main.js?v=${version}`)) {
    issues.push(`index.html missing main.js?v=${version}`);
  }
  if (!swContent.includes(`'v${version}'`) && !swContent.includes(`"v${version}"`)) {
    issues.push(`sw.js CACHE_VERSION not set to v${version}`);
  }
  if (packageJson.version !== version) {
    issues.push(`package.json version is ${packageJson.version}, expected ${version}`);
  }

  const lockPath = path.join(ROOT, 'package-lock.json');
  if (fs.existsSync(lockPath)) {
    const packageLock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    if (packageLock.version !== version) {
      issues.push(`package-lock.json version is ${packageLock.version}, expected ${version}`);
    }
    const rootPkgVersion = packageLock.packages && packageLock.packages['']
      ? packageLock.packages[''].version
      : undefined;
    if (rootPkgVersion !== version) {
      issues.push(
        `package-lock.json packages[""].version is ${rootPkgVersion}, expected ${version}`
      );
    }
  }

  return issues;
}

function main() {
  const checkOnly = process.argv.includes('--check');

  try {
    const version = readVersion();

    if (checkOnly) {
      console.log(`Current version: ${version}`);
      const issues = verifySync(version);
      if (issues.length) {
        console.error('Version mismatch:');
        issues.forEach((issue) => console.error(`  - ${issue}`));
        process.exit(1);
      }
      console.log('All version references are in sync.');
      return;
    }

    console.log(`Current version: ${version}`);
    updateIndexHtml(version);
    console.log('Updated index.html');
    updateSwJs(version);
    console.log('Updated sw.js');
    updatePackageJson(version);
    console.log('Updated package.json');
    updatePackageLockJson(version);
    console.log('Updated package-lock.json');

    const issues = verifySync(version);
    if (issues.length) {
      console.error('\nVersion update finished with issues:');
      issues.forEach((issue) => console.error(`  - ${issue}`));
      process.exit(1);
    }

    console.log('\nVersion update complete!');
    console.log(`\nFiles using version ${version}:`);
    console.log('  - js/version.js (source of truth)');
    console.log('  - index.html (style.css and main.js)');
    console.log('  - sw.js (CACHE_VERSION)');
    console.log('  - package.json');
    console.log('  - package-lock.json');
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
