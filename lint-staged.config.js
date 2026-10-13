export default {
  '*.{ts,tsx,js,jsx,mjs,cjs}': ['prettier --write', 'eslint --fix'],
  '*.{json,md,yml,yaml,css}': ['prettier --write'],
};
