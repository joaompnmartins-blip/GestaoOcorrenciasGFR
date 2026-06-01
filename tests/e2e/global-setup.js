'use strict';
const { setupSchema, truncateAll, createTestUsers } = require('../helpers/testdb');

module.exports = async function globalSetup() {
  await setupSchema();
  await truncateAll();
  await createTestUsers();
  console.log('E2E: utilizadores de teste criados.');
};
