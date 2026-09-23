import pino from 'pino';
import { env } from '../config/env';

const isProduction = env.node_env === 'production';

export const logger = pino({
  level: isProduction ? 'info' : 'debug',
  transport: isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
  redact: {
    paths: [
      '*.password',
      '*.token',
      '*.secret',
      '*.apiKey',
      '*.api_key',
      '*.authorization',
      '*.cookie',
      '*.cookies',
      '*.stripeSecretKey',
      '*.stripe_secret_key',
      '*.stripeWebhookSecret',
      '*.stripe_webhook_secret',
      '*.betterAuthSecret',
      '*.better_auth_secret',
      '*.mongodbUri',
      '*.mongodb_uri',
      '*.resendApiKey',
      '*.resend_api_key',
      '*.googleClientSecret',
      '*.google_client_secret',
      '*.githubClientSecret',
      '*.github_client_secret',
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers.set-cookie',
      'req.body.password',
      'req.body.token',
      'req.body.secret',
      'req.body.apiKey',
      'req.body.stripeSecretKey',
      'req.body.stripe_webhook_secret',
    ],
    censor: '[REDACTED]',
  },
  base: {
    service: 'testify-server',
    environment: env.node_env,
  },
});

export const createChildLogger = (bindings: Record<string, unknown>) => {
  return logger.child(bindings);
};

export default logger;