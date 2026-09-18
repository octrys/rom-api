import { loadConfig } from "../../config";
import { Logger, openDatabase } from "../../libraries";
import { SessionStore } from "./sessionStore";
import { AuthClient } from "./authClient";
import { createRegionApp } from "./regionService";

const main = (): void => {
    const config = loadConfig().region;
    const logger = Logger.getInstance("region");
    const sessions = new SessionStore(openDatabase(config.database), config.sessionTtlSeconds);
    const authClient = new AuthClient(config.authInternalUrl, logger);
    const app = createRegionApp(config, sessions, authClient, logger);
    app.listen(config.port, config.host, () => {
        logger.log(
            `region service (${config.code}) listening on ${config.host}:${config.port}; auth=${config.authInternalUrl}`
        );
    });
};

main();
