module.exports = {
  preset: 'react-native',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  transformIgnorePatterns: ['node_modules/(?!((jest-)?react-native|@react-native(-community)?|react-native-markdown-display|react-native-fit-image)/)'],
  modulePathIgnorePatterns: ['<rootDir>/.bat-worktrees/'],
  testPathIgnorePatterns: ['<rootDir>/.bat-worktrees/'],
};
