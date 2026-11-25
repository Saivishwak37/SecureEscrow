const { ConflictError, NotFoundError, ValidationError } = require('../utils/errors');

const publicFields = {
  id: true, username: true, email: true, role: true, name: true,
  isActive: true, createdAt: true, updatedAt: true,
};

function publicUser({ createdAt, updatedAt, ...user }) {
  return { ...user, createdAt: createdAt.getTime(), updatedAt: updatedAt.getTime() };
}

function postgresUsers(db) {
  async function provisionUser(credentials) {
    try {
      const user = await db.user.create({
        data: { ...credentials, accountViaUser: { create: { type: 'PERSONAL' } } },
        select: publicFields,
      });
      return publicUser(user);
    } catch (error) {
      if (error.code === 'P2002') throw new ConflictError('Username or email is already in use');
      throw error;
    }
  }

  async function getCredentialUserById(id) {
    const user = id && await db.user.findFirst({
      where: { id, passwordHash: { not: null } }, select: publicFields,
    });
    if (!user) throw new NotFoundError('User', id);
    return publicUser(user);
  }

  function findCredentialUserByEmail(email) {
    return db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  }

  // Match the functional unique index and avoid wildcard matching on usernames.
  async function findCredentialUserByUsername(username) {
    const [user] = await db.$queryRaw`
      SELECT id FROM "user" WHERE lower(username) = lower(${username.trim()})
    `;
    return user ?? null;
  }

  async function getUserById(id) {
    const user = await db.user.findUnique({ where: { id }, select: publicFields });
    if (!user) throw new NotFoundError('User', id);
    return publicUser(user);
  }

  async function list(where) {
    return (await db.user.findMany({ where, select: publicFields, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).map(publicUser);
  }

  async function createLegacyProfile({ name, type } = {}) {
    if (typeof name !== 'string' || !name.trim() || !['CLIENT', 'PROVIDER'].includes(type)) {
      throw new ValidationError('A name and CLIENT or PROVIDER type are required');
    }
    const user = await db.user.create({ data: { name: name.trim(), role: type }, select: publicFields });
    return { ...publicUser(user), type: user.role };
  }

  return { provisionUser, getCredentialUserById, findCredentialUserByEmail, findCredentialUserByUsername, getUserById, list, createLegacyProfile };
}

module.exports = postgresUsers;
