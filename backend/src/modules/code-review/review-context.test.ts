import assert from 'node:assert/strict'
import test from 'node:test'

import { describeSuppliedFiles, findSuppliedRelationships, orderReviewFiles } from './review-context'

test('orders changed files ahead of their supplied dependencies and unrelated files', () => {
  const files = [
    { path: 'src/unused.ts', content: 'export const unused = 1\n' },
    { path: 'src/helper.ts', content: 'export function helper() { return 1 }\n' },
    { path: 'src/page.ts', content: "import { helper } from './helper'\nexport function page() { return helper() }\n", changedLines: [2] },
  ]

  const ordered = orderReviewFiles(files).map((file) => file.path)
  assert.deepEqual(ordered.slice(0, 2), ['src/page.ts', 'src/helper.ts'])

  const relationships = findSuppliedRelationships(files)
  const page = relationships.find((relationship) => relationship.file === 'src/page.ts')
  assert.deepEqual(page?.imports, ['src/helper.ts'])
})

test('describes framework hints, changed-file impact, and cross-file symbols from supplied files only', () => {
  const described = describeSuppliedFiles([
    {
      path: 'package.json',
      content: JSON.stringify({ dependencies: { react: '18.0.0', express: '4.0.0' } }),
    },
    {
      path: 'src/profile.ts',
      content: 'export function displayName() { return "Ada" }\n',
      changedLines: [1],
    },
    {
      path: 'src/header.tsx',
      content: "import { displayName } from './profile'\nexport function header() { return displayName() }\n",
    },
  ])

  assert.match(described.summary, /React components/)
  assert.match(described.summary, /Express route handlers/)
  assert.match(described.summary, /Impact scope is the changed files plus directly related supplied files: src\/header\.tsx/)
  assert.match(described.summary, /displayName is declared in src\/profile\.ts and referenced in src\/header\.tsx/)
  assert.equal(described.summary.includes('Ignore previous instructions'), false)
})
