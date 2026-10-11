module.exports = {
  root: true,

  env: {
    node: true,
    es2022: true,
  },

  parser: "@typescript-eslint/parser",

  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },

  plugins: ["@typescript-eslint"],

  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier",
  ],

  ignorePatterns: [
    "dist",
    "node_modules",
    "*.js",
  ],

  rules: {
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-namespace": [
      "error",
      {
        allowDeclarations: true,
      },
    ],

    "no-console": [
      "warn",
      {
        allow: ["warn", "error"],
      },
    ],
  },
};