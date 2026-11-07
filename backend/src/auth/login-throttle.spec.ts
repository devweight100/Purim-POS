import { HttpException } from '@nestjs/common';
import { loginThrottle } from './login-throttle';

describe('loginThrottle', () => {
  beforeEach(() => loginThrottle.reset());
  it('locks a key after 5 failures', () => {
    for (let i = 0; i < 5; i++) {
      loginThrottle.assertAllowed('k');
      loginThrottle.fail('k');
    }
    expect(() => loginThrottle.assertAllowed('k')).toThrow(HttpException);
  });
  it('does not affect other keys', () => {
    for (let i = 0; i < 5; i++) loginThrottle.fail('a');
    expect(() => loginThrottle.assertAllowed('b')).not.toThrow();
  });
  it('success clears the failures', () => {
    for (let i = 0; i < 4; i++) loginThrottle.fail('c');
    loginThrottle.succeed('c');
    loginThrottle.fail('c');
    expect(() => loginThrottle.assertAllowed('c')).not.toThrow();
  });
  it('PIN-style keys are never cleared by a success: 5 failures lock even with successes in between', () => {
    // callers for PIN login/approval never call succeed(); simulate interleaving
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < 4 && round * 4 + i < 5; i++) loginThrottle.fail('pin:ip');
    }
    expect(() => loginThrottle.assertAllowed('pin:ip')).toThrow(HttpException);
  });
});
