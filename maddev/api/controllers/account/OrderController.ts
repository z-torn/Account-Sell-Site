import express = require('@types/express');
import {Paypal} from "../payment/paypal/Paypal";
import {ApiType} from "../payment/paypal/impl/PaypalApiType";
import {PaypalSettings} from "../payment/paypal/internal/PaypalSettings";
import {IApiError} from "../../impl/IApiError";
import {Util} from "../../util/Util";
import {IAccount} from "../../models/Account";
import {PaymentExecutor} from "../payment/paypal/PaymentExecutor";
import {ProcessedPaypalOrder} from "../../models/ProcessedOrder";
import {Order, Orders} from "../../models/Order";
import {UnprocessedPaypal, UnprocessedPaypals} from "../../models/UnprocessedPaypal";
import {PaymentMethod} from "../../models/Payment";

export class OrderController {

    /**
     * Creates a paypal order, and returns the paypal checkout url.
     * Buyer email is optional, this will only be used to send the accounts
     * to email if they would like a second copy.
     * @param quantity
     * @param ip
     * @param buyerEmail
     * @returns {Promise<any>}
     */
    async createOrder(quantity : number, ip : string, buyerEmail? : string) : Promise<string | IApiError> {
        if(quantity == null || typeof quantity !== 'number' || isNaN(quantity)) {
            return {'error' : 'Invalid quantity.'};
        }
        if(buyerEmail != null && (typeof buyerEmail != 'string') || !Util.isEmail(buyerEmail)) {
            return {'error' : 'Invalid email.'};
        }
        const settings = await PaypalSettings.generate(ApiType.SANDBOX);
        const paypal = new Paypal(settings);
        try {
            const checkoutUrl = await paypal.createPayment(quantity, ip, buyerEmail);
            return checkoutUrl;
        } catch(err) {
            console.log(err);
            return {'error' : 'Failed to create Paypal order.'};
        }
    }

    /**
     * Finish the Paypal order, attempting to grab the amount of accounts and
     * return them. If we do not have enough accounts, an empty array will be returned.
     * The payment will never be charged if the array is empty.
     *
     * This method SHOULD ONLY be called from the route associated with it,
     * which should only be executed on a paypal redirect after payment.
     * @param paymentId
     * @param payerId
     * @returns {Promise<any>}
     */
    async completeOrder(paymentId : string, payerId) : Promise<IAccount[] | IApiError> {
        const paypalSettings = await PaypalSettings.generate(ApiType.SANDBOX);
        const executor = new PaymentExecutor(paymentId, payerId, paypalSettings);
        let res;
        try {
            res = await executor.execute();
        } catch(err) {
            console.log(err);
            return {'error' : 'Failed to complete paypal payments.'};
        }
        if(res['error'] != null) {
            return res as IApiError;
        }
        const processed = res as ProcessedPaypalOrder;
        if(processed.accounts.length == 0) {
            return {
                error : 'We do not have enough accounts to fulfill your order.',
                meta : 'outOfStock'
            };
        }
        /**
         * Save the order to the database, then return the accounts.
         * @type {boolean}
         */
        const save = await this.saveOrder(paymentId, processed);
        return processed.accounts;
    }


    async saveOrder(paymentId : string, order : ProcessedPaypalOrder) : Promise<boolean> {
        try {
            const details = await UnprocessedPaypals.findOne({paymentId: paymentId}).lean().exec() as UnprocessedPaypal;
            if (details == null) {
                console.log("Failed to lookup unprocesed paypal order in save order.");
                return false;
            }
            const names = order.accounts.map(s => s.email);
            const o = new Order(
                details.total, details.ip, details.buyerEmail, PaymentMethod.PAYPAL, names, order.buyer
            );
            const create = await Orders.create(o);
            return create['_id'] != null;
        } catch(err) {
            console.log(err);
            console.log(`Failed to save order ${paymentId}`);
        }
        return false;
    }
}

export class OrderControllerRoutes {

    /**
     * Create an instance of the controller because
     * we will not be able to access this class instance as a
     * route handler, due to the reference of "this" being changed
     * to the calling class.
     * @type {OrderController}
     */
    private static controller : OrderController = new OrderController();

    async createOrder(req : express.Request, res : express.Response) {

        const instance = OrderControllerRoutes.controller;
        const quantity = req.body.quantity;
        const email = req.body.email;

        const checkout = await instance.createOrder(quantity, Util.getIP(req), email);
        /**
         * Failed to create checkout, display error to user.
         */
        if(checkout['error'] != null) {
            return res.json(checkout);
        }
        return res.json({'checkout' : checkout});
    }

    async completeOrder(req : express.Request, res : express.Response) {

        const instance = OrderControllerRoutes.controller;
        const paymentId = req.body.paymentId;
        const payerId = req.body.payerId;

        if(paymentId == null || payerId == null) {
            return res.json({error : 'Missing parameters.'});
        }

        if(typeof paymentId != 'string' || typeof payerId != 'string') {
            return res.json({error : 'Invalid parameters.'});
        }
        const accounts = await instance.completeOrder(paymentId, payerId);
        return res.json(accounts);
    }
}