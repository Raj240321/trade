module.exports = {
  env: {
    es6: true,
    node: true
  },
  extends: [
    'standard'
  ],
  globals: {
    Atomics: 'readonly',
    SharedArrayBuffer: 'readonly'
  },
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module'
  },
  rules: {
    'no-async-promise-executor': 'off',
    'max-params': ['warn', {
      max: 6
    }], // Enforce a maximum number of parameters in function definitions
    'space-before-function-paren': ['error', {
      anonymous: 'ignore',
      named: 'ignore',
      asyncArrow: 'ignore'
    }],
    // 'no-var': 'warn',
    // 'require-await': 'warn', // Disallow async functions which have no await expression
    // 'default-case': 'warn', // Require default cases in switch statements
    // 'no-console': 'warn', // Disallow the use of console
    // 'no-const-assign': 'warn', // Disallow reassigning const variables
    'no-case-declarations': 'warn', // Disallow lexical declarations in case clauses
    // complexity: ['warn', 10], // Enforce a maximum cyclomatic complexity allowed in a program
    // 'require-atomic-updates': 'warn', // Disallow assignments that can lead to race conditions due to usage of await or yield
    // eqeqeq: ['warn', 'smart'], // Require the use of === and !==, but smartly.
    // 'max-depth': ['warn', 5], // Enforce a maximum depth that blocks can be nested
    // 'max-nested-callbacks': ['warn', 3] // Enforce a maximum depth that callbacks can be nested
    'max-lines-per-function': ['error', {
      max: 300
    }],
    'max-lines': ['error', {
      max: 800
    }]
  }
}
