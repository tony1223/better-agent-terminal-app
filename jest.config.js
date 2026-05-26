module.exports = {
  preset: 'react-native',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  modulePathIgnorePatterns: ['<rootDir>/.bat-worktrees/'],
  testPathIgnorePatterns: ['<rootDir>/.bat-worktrees/'],
};
