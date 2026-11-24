const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const jwtService = require('./jwtService');

function configureSecret() {
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('base64');
}

describe('JWT service', () => {
  beforeEach(() => {
    configureSecret();
    delete process.env.JWT_EXPIRES_IN;
  });

  test('signs and verifies a minimal HS256 identity token', () => {
    const token = jwtService.signAccessToken({ id: 'user-123', role: 'CLIENT' });
    const claims = jwtService.verifyAccessToken(token);

    expect(claims).toMatchObject({ sub: 'user-123', role: 'CLIENT' });
    expect(claims.iat).toEqual(expect.any(Number));
    expect(claims.exp - claims.iat).toBe(15 * 60);
    expect(jwt.decode(token)).not.toHaveProperty('password');
    expect(jwt.decode(token)).not.toHaveProperty('passwordHash');
  });

  test('supports all defined user roles', () => {
    for (const role of ['CLIENT', 'PROVIDER', 'ADMIN']) {
      expect(jwtService.verifyAccessToken(jwtService.signAccessToken({ id: `user-${role}`, role })).role).toBe(role);
    }
  });

  test('rejects tokens signed with another secret', () => {
    const token = jwtService.signAccessToken({ id: 'user-123', role: 'CLIENT' });
    configureSecret();
    expect(() => jwtService.verifyAccessToken(token)).toThrow('Invalid or missing authentication credentials');
  });

  test('rejects tampered and malformed tokens', () => {
    const token = jwtService.signAccessToken({ id: 'user-123', role: 'CLIENT' });
    const [header, payload, signature] = token.split('.');
    const tampered = `${header}.${payload}.${signature[0] === 'a' ? 'b' : 'a'}${signature.slice(1)}`;
    expect(() => jwtService.verifyAccessToken(tampered)).toThrow('Invalid or missing authentication credentials');
    expect(() => jwtService.verifyAccessToken('not-a-jwt')).toThrow('Invalid or missing authentication credentials');
  });

  test('rejects unsupported algorithms', () => {
    const token = jwt.sign({ role: 'CLIENT' }, process.env.JWT_SECRET, {
      algorithm: 'HS512', subject: 'user-123', expiresIn: '1m'
    });
    expect(() => jwtService.verifyAccessToken(token)).toThrow('Invalid or missing authentication credentials');
  });

  test('rejects expired tokens', () => {
    const token = jwt.sign({ role: 'CLIENT' }, process.env.JWT_SECRET, {
      algorithm: 'HS256', subject: 'user-123', expiresIn: -1
    });
    expect(() => jwtService.verifyAccessToken(token)).toThrow('Invalid or missing authentication credentials');
  });

  test.each([
    [{ role: 'CLIENT' }, 'missing subject'],
    [{ sub: 'user-123', role: 'ROOT' }, 'invalid role']
  ])('rejects claims with a %s', (claims) => {
    const token = jwt.sign(claims, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1m' });
    expect(() => jwtService.verifyAccessToken(token)).toThrow('Invalid or missing authentication credentials');
  });

  test('rejects invalid identity when signing', () => {
    expect(() => jwtService.signAccessToken({ id: '', role: 'CLIENT' })).toThrow('invalid identity');
    expect(() => jwtService.signAccessToken({ id: 'user-123', role: 'ROOT' })).toThrow('invalid identity');
  });

  test('requires a strong configured secret', () => {
    delete process.env.JWT_SECRET;
    expect(() => jwtService.getJwtConfig()).toThrow('JWT_SECRET');
    process.env.JWT_SECRET = 'short';
    expect(() => jwtService.getJwtConfig()).toThrow('JWT_SECRET');
    process.env.JWT_SECRET = 'a'.repeat(48);
    expect(() => jwtService.getJwtConfig()).toThrow('JWT_SECRET');
  });

  test('defaults expiration to 15 minutes and rejects invalid or excessive durations', () => {
    expect(jwtService.getJwtConfig().expiresIn).toBe('15m');
    process.env.JWT_EXPIRES_IN = '1h';
    expect(jwtService.getJwtConfig().expiresIn).toBe('1h');
    process.env.JWT_EXPIRES_IN = 'soon';
    expect(() => jwtService.getJwtConfig()).toThrow('JWT_EXPIRES_IN');
    process.env.JWT_EXPIRES_IN = '31d';
    expect(() => jwtService.getJwtConfig()).toThrow('30 days');
  });
});
