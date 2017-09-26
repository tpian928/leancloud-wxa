const uuid = require('uuid/v4');
const AV = require('leanengine');
const Order = require('../model/order');
const { wxpay, wxapi } = require('../libs/wxapi');
const { mul } = require('../libs/utils');

/** 
 * 小程序创建订单
 */
AV.Cloud.define('order', (request, response) => {
    const user = request.currentUser;
    if (!user) {
        return response.error(new Error('用户未登录'));
    }
    const authData = user.get('authData');
    if (!authData || !authData.lc_weapp) {
        return response.error(new Error('当前用户不是小程序用户'));
    }

    const { storeId, con, address, username, userphone } = request.params;
    const order = new Order();
    order.tradeId = uuid().replace(/-/g, '');
    order.status = 'INIT';
    order.user = request.currentUser;

    order.dostatus = 0;
    order.address = address;
    order.username = username;
    order.userphone = userphone;

    // 计算总价
    let price = 0;
    let productArr = [];
    for (let i = 0; i < con.length; i++) {
        price += con[i].price * con[i].num;
        let menu = AV.Object.createWithoutData('Menu', con[i].food_id);
        let orderCon = new AV.Object('OrderCon');
        orderCon.set('menu', menu);
        orderCon.set('num', con[i].num);
        orderCon.set('price', con[i].price);
        orderCon.set('order', order);
        productArr.push(orderCon);
    }
    const query = new AV.Query('Store');
    Promise.all([
        query.get(storeId),
        AV.Object.saveAll(productArr),
    ]).then((data) => {
        const store = data[0];
        order.store = store;
        order.productDescription = store.get('name');
        order.con = con;
        order.amount = mul(price, 100);
        order.ip = request.meta.remoteAddress;
        if (!(order.ip && /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(order.ip))) {
            order.ip = '127.0.0.1';
        }
        order.tradeType = 'JSAPI';
        const acl = new AV.ACL();
        // 只有创建订单的用户可以读，没有人可以写
        acl.setPublicReadAccess(false);
        acl.setPublicWriteAccess(false);
        acl.setReadAccess(user, true);
        acl.setWriteAccess(user, false);
        order.setACL(acl);
        return order.place();
    }).then(() => {
        console.log(`预订单创建成功：订单号 [${order.tradeId}] prepayId [${order.prepayId}]`);
        const payload = {
            appId: process.env.WEIXIN_APPID,
            timeStamp: String(Math.floor(Date.now() / 1000)),
            package: `prepay_id=${order.prepayId}`,
            signType: 'MD5',
            nonceStr: String(Math.random()),
        }
        payload.paySign = wxpay.sign(payload);
        response.success(payload);
    }).catch(error => {
        console.error(error);
        response.error(error);
    });
});
