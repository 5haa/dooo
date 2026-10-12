'use strict';
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
require('esbuild').buildSync({ entryPoints: [path.join(__dirname, 'entry.ts')], outfile: path.join(__dirname, 'dist/index.cjs'),
  bundle: true, platform: 'node', format: 'cjs', target: 'node22', packages: 'external', legalComments: 'inline',
  alias: { '@ui-tars/sdk/core': path.join(root, 'vendor/ui-tars/sdk/src/core.ts'),
    '@ui-tars/shared/types': path.join(root, 'vendor/ui-tars/shared/src/types/index.ts'),
    '@ui-tars/shared/constants': path.join(root, 'vendor/ui-tars/shared/src/constants/index.ts'),
    '@ui-tars/shared/utils': path.join(root, 'vendor/ui-tars/shared/src/utils/index.ts'),
    '@ui-tars/action-parser': path.join(root, 'vendor/ui-tars/action-parser/src/index.ts') } });
