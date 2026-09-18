import { loadConfig } from "../../config";
import { Logger, openDatabase } from "../../libraries";
import { AccountStore } from "./accountStore";
import { TokenStore } from "./tokenStore";
import { createAuthApp } from "./authService";

const main = (): void => {
    const config = loadConfig().auth;
    const logger = Logger.getInstance("auth");
    const db = openDatabase(config.database);
    const store = new AccountStore(db);
    const tokens = new TokenStore(db, config.authTokenTtlSeconds);
    const app = createAuthApp(config, store, tokens, logger);
    app.listen(config.port, config.host, () => {
        logger.log(`auth service listening on ${config.host}:${config.port} (db ${config.database})`);
    });
};

main();
