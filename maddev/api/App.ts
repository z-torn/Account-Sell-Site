import path = require('path');
import mongoose = require('mongoose');
import {WebServer} from "./WebServer";
import {ViewRouteManager} from "./routes/ViewRouteManager";
import {ApiRouteManager} from "./routes/ApiRouteManager";
import {ApiAccountRoutes} from "./routes/children/ApiAccountRoutes";
import {MongoError} from "mongodb";
import {Paypal} from "./controllers/payment/paypal/Paypal";
import {ApiType} from "./controllers/payment/paypal/impl/PaypalApiType";
import {PaypalSettings} from "./controllers/payment/paypal/internal/PaypalSettings";

class App {
    constructor() {
        const server = new WebServer(
            {
                port: 3000,
                staticPath: path.join(__dirname, '../', 'client', 'public'),
                viewPath: path.join(__dirname, '../', 'client', 'views')
            });

        const apiManager = new ApiRouteManager("/api", server.app);

        const accountRoutes = new ApiAccountRoutes("/accounts", apiManager);
        /**
         * Set the account routes.
         */
        accountRoutes.initialize();
        /**
         * Initialize the JSON API Routes of the server.
         */
        apiManager.initialize();

        /**
         * Initialize the views that the server will render.
         * These are not api routes.
         */
        new ViewRouteManager(server.app)
            .addView("/", "app")
            .initialize();

        /**
         * Start the web server on the specified port from the settings object.
         * If no port was passed in, it is defaulted to 80.
         */
        server.listen();

        mongoose.connect("mongodb://localhost/accountseller", (err: MongoError) => {
            if (err) {
                console.log(err);
                return;
            }
            console.log("Connected to MongoDB.");
        });

        const getKey = async () => {
            const settings = await PaypalSettings.generate(ApiType.SANDBOX);
            const paypal = new Paypal(settings);
            const payment = await paypal.createPayment(10);
            console.log(payment);
        };
        getKey();
    }

}

new App();

