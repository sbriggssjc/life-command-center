import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { validateManifestFile, resolvePrivateSourcePath } from './manifest.mjs';
import { validateNuccTaxonomyFile } from './nucc-taxonomy.mjs';
import { canonicalJson, profileNppesFile } from './nppes.mjs';

export async function runProfile(manifestPath, outputPath, options = {}) {
  const validation = await validateManifestFile(manifestPath, options);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const nppesSource = manifest.sources.find((source) => source.name === 'nppes_v2_monthly');
  const taxonomySource = manifest.sources.find((source) => source.name === 'nucc_taxonomy');
  const secondarySource = manifest.sources.find((source) => source.name === 'nppes_secondary_locations');
  const nppesPath = resolvePrivateSourcePath(manifestPath, nppesSource.object_path, options);
  const taxonomyPath = resolvePrivateSourcePath(manifestPath, taxonomySource.object_path, options);
  const secondaryPath = resolvePrivateSourcePath(manifestPath, secondarySource.object_path, options);
  const taxonomyAssertions = await validateNuccTaxonomyFile(taxonomyPath);
  const taxonomyFingerprint = createHash('sha256').update(canonicalJson(taxonomyAssertions)).digest('hex');
  const receipt = await profileNppesFile(nppesPath, {
    freezeDate: manifest.freeze_date,
    manifestSha256: validation.manifest_sha256,
    taxonomyFingerprint,
    transformVersion: manifest.transform_version,
    secondaryPath,
  });
  const destination = path.resolve(outputPath);
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, canonicalJson(receipt), { encoding: 'utf8', flag: 'wx' });
  await rename(temporary, destination);
  return receipt;
}
