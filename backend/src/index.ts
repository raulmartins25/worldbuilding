import { buildApp } from "./app";
import { env } from "./env";

const app = buildApp();

app
  .listen({ port: env.PORT, host: env.HOST })
  .then((address) => app.log.info(`Loregrid API em ${address}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
