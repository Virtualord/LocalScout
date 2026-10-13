/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'refactor',
        'perf',
        'test',
        'docs',
        'build',
        'ci',
        'chore',
        'revert',
        // Merge commits use a `merge: phase N - summary` header, which has no
        // conventional-commit type. Allowed here rather than forcing --no-verify.
        'merge',
      ],
    ],
    'scope-enum': [
      2,
      'always',
      [
        'repo',
        'tooling',
        'core',
        'db',
        'discovery',
        'audit',
        'draft',
        'workflow',
        'api',
        'web',
        'eval',
        'docs',
        'adr',
        'ci',
        'deps',
      ],
    ],
    'subject-case': [0],
    'subject-full-stop': [2, 'never', '。'],
    'header-max-length': [2, 'always', 72],
    'body-max-line-length': [0],
  },
};
