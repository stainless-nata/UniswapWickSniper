import http from 'http'
import path from 'path'
import { fileURLToPath } from 'url'
import ethers, { BigNumber } from 'ethers'
import fs from 'fs'
import chalk from 'chalk'
import { data } from './config.js'
import express from 'express'
import expressWs from 'express-ws'
import axios from 'axios'
import CryptoJS from 'crypto-js';
import { sqrt } from 'mathjs'
import { clearInterval } from 'timers'
import Web3 from 'web3';
import getTokenPrice from './utils/TokenPrice.js'

import {
    fetchGraphQL,
    QueryType,
} from "./graphql.js"

const app = express()
const httpServer = http.createServer(app)
const wss = expressWs(app, httpServer)

var aWss = wss.getWss('/')

let isBuy = false;
let isSell = false;
var vwapBotStatus = false
var limitBotStatus = false
var router
let web3
let provider
let wallet
let account
let tokenRating = {}
let blockNumber = 0
let prevTime

var asset = JSON.parse(fs.readFileSync("./asset.json", "utf-8"));

const delay = (ms) => new Promise((res) => setTimeout(res, ms)); // delay time
const save = (type, obj) => {
    let myJSON = JSON.stringify(obj);
    fs.writeFile(`./${type}.json`, myJSON, (err) => {
      if (err) console.log(err);
    });
};

const runVwap = async (priceSum, count) => {
    if(!vwapBotStatus) return;
    // console.log("Get Block Number:");
    const number = await provider.getBlockNumber();
    const ethPrice = (await router.getAmountsOut(1000000000, [
        data.WETH_ADDRESS,
        data.DAI_ADDRESS,
    ]))[1].toNumber() / 1000000000;
    for (const key in asset) {
        const tokenPrice = (await router.getAmountsOut(1000000000, [
            key,
            data.WETH_ADDRESS,
        ]))[1].toNumber() / 1000000000;
        priceSum[key] += tokenPrice * ethPrice;
    }
    count ++;

    if (number != blockNumber && blockNumber != 0) {
        console.log("New block minted(VWAP)");
        for(const i in asset) {
            priceSum[i] /= count;
        }
        // console.log(priceSum);
        await updateTokenData(priceSum);

        for(const i in asset) {
            priceSum[i] = 0;
        }
        count = 0;
    }
    blockNumber = number;

    await delay(500);
    runVwap(priceSum, count);
}

const updateTokenData = async () => {
    console.log("Update Trading Volume Data:");

    const ethPrice = (await router.getAmountsOut(1000000000, [
        data.WETH_ADDRESS,
        data.DAI_ADDRESS,
    ]))[1].toNumber() / 1000000000;
    let time = new Date(Date.now());

    for(const i in asset) {
        let res = await fetchGraphQL(QueryType(i, prevTime.toISOString()));
        const buy = res.buyside, sell = res.sellside;
        
        for(const j in buy) {
            const t = buy[j];
            if(t.Trade.Buy.Currency.SmartContract == i.toLowerCase() && t.Trade.Sell.Currency.SmartContract == "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2")
            tokenRating[i].push({
                volume: t.Trade.Sell.Amount * ethPrice,
                price: t.Trade.Buy.Price * ethPrice,
            });
        }
        for(const j in sell) {
            const t = sell[j];
            if(t.Trade.Sell.Currency.SmartContract == i.toLowerCase() && t.Trade.Buy.Currency.SmartContract == "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2")
            tokenRating[i].push({
                volume: t.Trade.Buy.Amount * ethPrice,
                price: t.Trade.Sell.Price * ethPrice,
            });
        }
        
        let volumeSum = 0, priceSum = 0, vwap = 0, token;
        for(const j in tokenRating[i]) {
            const t = tokenRating[i][j];

            priceSum = priceSum + t.volume * t.price;
            volumeSum = volumeSum + t.volume;

            if(volumeSum == 0) vwap = 0;
            else vwap = priceSum / volumeSum;

            tokenRating[i][j].vwap = vwap;
        }
    }

    prevTime = time;
    compare();
}

const getTokenData = async () => {
    console.log("Get Trading Volume Data:");
    
    let time = new Date(Date.now());

    for(const i in asset) {
        if(tokenRating[i] == undefined) tokenRating[i] = []

        const res = await fetchGraphQL(QueryType(i, `${time.toISOString().slice(0,10)}T00:00:00Z`));
        const buy = res.buyside, sell = res.sellside;
        
        for(const j in buy) {
            const t = buy[j];
            if(t.Trade.Buy.Currency.SmartContract == i.toLowerCase() && t.Trade.Sell.Currency.SmartContract == "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2")
                tokenRating[i].push({
                    volume: t.Trade.Sell.Amount,
                    price: t.Trade.Buy.Price,
                });
        }
        for(const j in sell) {
            const t = sell[j];
            if(t.Trade.Sell.Currency.SmartContract == i.toLowerCase() && t.Trade.Buy.Currency.SmartContract == "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2")
                tokenRating[i].push({
                    volume: t.Trade.Buy.Amount,
                    price: t.Trade.Sell.Price,
                });
        }

        const ethPrice = (await router.getAmountsOut(1000000000, [
            data.WETH_ADDRESS,
            data.DAI_ADDRESS,
        ]))[1].toNumber() / 1000000000;

        let volumeSum = 0, priceSum = 0, currentPrice = 0, vwap = 0;
        for(const j in tokenRating[i]) {
            const t = tokenRating[i][j];

            currentPrice = t.price * ethPrice;
            priceSum = priceSum + t.volume * ethPrice * currentPrice;
            volumeSum = volumeSum + t.volume * ethPrice;

            if(volumeSum == 0) vwap = 0;
            else vwap = priceSum / volumeSum;

            tokenRating[i][j].volume = t.volume * ethPrice;
            tokenRating[i][j].price = currentPrice;
            tokenRating[i][j].vwap = vwap;
        }
    }
    prevTime = time
}

const compare = async () => {
    for (const i in asset) {
        let sum = 0, std = 0, count = 0, vwap = 0, currentPrice = 0;
        for(const j in tokenRating[i]) {
            const t = tokenRating[i][j];
            // console.log(t);
            sum = sum + (t.vwap - t.price) * (t.vwap - t.price);
            count ++;
            
            std = sum / count;
            std = sqrt(std);
            tokenRating[i][j].std = std;

            currentPrice = t.price;
            vwap = t.vwap;
        }
        
        console.log("Standard Deviation: ", std);

        const upperband = vwap + std * asset[i].vwap,
              lowerband = vwap - std * asset[i].vwap;
        console.log("Upper Band: ", upperband);
        console.log("Lower Band: ", lowerband);
        console.log("Current Price: ", currentPrice);

        aWss.clients.forEach(function (client) {
            var detectObj = {
                address: i,
                status: vwap,
                amount: `${currentPrice}, ${blockNumber}`,
                transaction: `${upperband}, ${lowerband}`,
            }
            var detectInfo = JSON.stringify(detectObj)
            client.send(detectInfo)
        })

        if(vwap!=0 && vwapBotStatus) {
            if(lowerband >= currentPrice && !isBuy && (data.mode == "buyMode" || data.mode == "normalMode"))
            {
                console.log("Execute Buy Action");
                aWss.clients.forEach(function (client) {
                    var detectObj = {
                        address: i,
                        status: "Buy",
                        amount: currentPrice,
                        transaction: `${upperband}, ${lowerband}`,
                    }
                    var detectInfo = JSON.stringify(detectObj)
                    client.send(detectInfo)
                })
                await executeTrade("buy", i, asset[i].amount, asset[i].slippage, asset[i].gasPrice, asset[i].gasLimit);
                vwapBotStatus = false
            }
            if(upperband <= currentPrice && !isSell && (data.mode == "sellMode" || data.mode == "normalMode")) {
                console.log("Execute Sell Action");
                aWss.clients.forEach(function (client) {
                    var detectObj = {
                        address: i,
                        status: "Sell",
                        amount: currentPrice,
                        transaction: `${upperband}, ${lowerband}`,
                    }
                    var detectInfo = JSON.stringify(detectObj)
                    client.send(detectInfo)
                })
                await executeTrade("sell", i, asset[i].amount, asset[i].slippage, asset[i].gasPrice, asset[i].gasLimit);
                vwapBotStatus = false
            } 
            if(lowerband < currentPrice && upperband > currentPrice) {
                aWss.clients.forEach(function (client) {
                    var detectObj = {
                        address: i,
                        status: "Condition Error",
                        amount: currentPrice,
                        transaction: `${upperband}, ${lowerband}`,
                    }
                    var detectInfo = JSON.stringify(detectObj)
                    client.send(detectInfo)
                })
                console.log("Condition Error");
            }
        } else {
            console.log("Bot is not started!");
        }
    }
}

const executeTrade = async (type, address, amount, slippage, _gasPrice, gasLimit) => {

    let gasPrice = await provider.getGasPrice();
    gasPrice = gasPrice.mul(parseInt(_gasPrice)).div(100);

    if(type == "buy") {
        isBuy = true;

        const balance = await account.getBalance();
        let ethAmount;
        if(amount.includes('%')) {
            ethAmount = balance.mul(parseInt(parseFloat(amount.replace('%','')) * 100)).div(10000);
            ethAmount = parseFloat(ethers.utils.formatEther(ethAmount));
        } else {
            ethAmount = parseFloat(amount);
        }
        if(parseFloat(ethers.utils.formatEther(balance)) <= ethAmount + 0.001) {
            console.log("Low ETH Balance");
            aWss.clients.forEach(function (client) {
                var detectObj = {
                    address: address,
                    status: "Failed",
                    amount: ethAmount,
                    transaction: "Low ETH Balance",
                }
                var detectInfo = JSON.stringify(detectObj)
                client.send(detectInfo)
            })
            return;
        }

        var amountIn = ethers.utils.parseUnits(
            ethAmount.toString(),
            "ether"
        );

        var amounts = await router.getAmountsOut(amountIn, [
            data.WETH_ADDRESS,
            address,
        ]);
        var amountOutMin = amounts[1].sub(
            amounts[1].mul(`${slippage*10}`).div(1000)
        );

        console.log(chalk.green.inverse(`Buying Token\n`));

        let buy_tx = await router.swapExactETHForTokens(
            amountOutMin,
            [data.WETH_ADDRESS, address],
            data.wallet,
            Date.now() + 5 * 60 * 1000,
            {
                gasPrice: gasPrice,
                gasLimit: gasLimit,
                value: amountIn,
            }
        ).catch((err) => {
            console.log('Transaction failed: ', err.reason);

            aWss.clients.forEach(function (client) {
                var detectObj = {
                    address: address,
                    status: "Failed",
                    amount: ethAmount,
                    transaction: err.reason,
                }
                var detectInfo = JSON.stringify(detectObj)
                client.send(detectInfo)
            })
        })

        if(!buy_tx) return;
        console.log(buy_tx);

        aWss.clients.forEach(function (client) {
            var detectObj = {
                address: address,
                status: "Pending...",
                amount: ethAmount,
                transaction: buy_tx.tx,
            }
            var detectInfo = JSON.stringify(detectObj)
            client.send(detectInfo)
        })
        
        let tx = await buy_tx.wait();

        aWss.clients.forEach(function (client) {
            var detectObj = {
                address: address,
                status: "Success",
                amount: ethAmount,
                transaction: buy_tx.tx,
            }
            var detectInfo = JSON.stringify(detectObj)
            client.send(detectInfo)
        })

        console.log(tx);
        isBuy = false;

    } else if (type == "sell") {
        isSell = true;

        if(amount.includes('%')) {
            let percent = parseFloat(amount.replace('%',''));
            const tokenContract = new ethers.Contract(
                address,
                data.decimalABI,
                account
            )
            const balance = await tokenContract.balanceOf(data.wallet);
            const decimal = await tokenContract.decimals();
            let tokenAmount;

            tokenAmount = parseInt(ethers.utils.formatUnits(balance, decimal)) * percent / 100;

            if(balance == 0) {
                aWss.clients.forEach(function (client) {
                    var detectObj = {
                        address: address,
                        status: "Failed",
                        amount: tokenAmount,
                        transaction: "Low Token Balance",
                    }
                    var detectInfo = JSON.stringify(detectObj)
                    client.send(detectInfo)
                })
                console.log("Low Token Balance");
                return;
            }
    
            let allow = await tokenContract.allowance(data.wallet, data.routerAddress)
            allow = parseFloat(ethers.utils.formatUnits(allow, decimal));

            if(tokenAmount > allow) {
                console.log("Approve...");
                const approve_tx = await tokenContract.approve(
                    data.routerAddress,
                    ethers.utils.parseUnits(
                        tokenAmount.toString(),
                        decimal
                    ),
                    {
                        gasPrice: gasPrice,
                        gasLimit: gasLimit,
                    },
                )
                const result = await approve_tx.wait();
                console.log(result);
            }
    
            console.log(chalk.green.inverse(`Selling Token\n`));
    
            let buy_tx = await router.swapExactTokensForETHSupportingFeeOnTransferTokens(
                ethers.utils.parseUnits(
                    tokenAmount.toString(),
                    "ether"
                ),
                0,
                [address, data.WETH_ADDRESS],
                data.wallet,
                Date.now() + 5 * 60 * 1000,
                {
                    gasPrice: gasPrice,
                    gasLimit: gasLimit,
                }
            ).catch((err) => {
                console.log(err);
                console.log('Transaction failed: ', err.reason);
    
                aWss.clients.forEach(function (client) {
                    var detectObj = {
                        address: address,
                        status: "Failed",
                        amount: tokenAmount,
                        transaction: err.reason,
                    }
                    var detectInfo = JSON.stringify(detectObj)
                    client.send(detectInfo)
                })
            })
    
            if(!buy_tx) return;
            console.log(buy_tx);
    
            aWss.clients.forEach(function (client) {
                var detectObj = {
                    address: address,
                    status: "Pending...",
                    amount: tokenAmount,
                    transaction: buy_tx.tx,
                }
                var detectInfo = JSON.stringify(detectObj)
                client.send(detectInfo)
            })
            
            let tx = await buy_tx.wait();
    
            aWss.clients.forEach(function (client) {
                var detectObj = {
                    address: address,
                    status: "Success",
                    amount: tokenAmount,
                    transaction: buy_tx.tx,
                }
                var detectInfo = JSON.stringify(detectObj)
                client.send(detectInfo)
            })
            console.log(tx);
        } else {
            let ethAmount = parseFloat(amount);
            const tokenContract = new ethers.Contract(
                address,
                data.decimalABI,
                account
            )
            const balance = await tokenContract.balanceOf(data.wallet);

            const amounts = await router.getAmountsIn(
                ethers.utils.parseUnits(
                    ethAmount.toString(),
                    decimal
                ), [
                    address,
                    data.WETH_ADDRESS,
                ]);
    
            var amountInMax = amounts[0].add(
                amounts[0].mul(`${slippage*10}`).div(1000)
            );
            // var amounts = await router.getAmountsOut(balance, [
            //     address,
            //     data.WETH_ADDRESS,
            // ]);
            // var amountOutMin = amounts[1].sub(
            //     amounts[1].mul(`${slippage*10}`).div(1000)
            // );
            const tokenAmount = parseInt(ethers.utils.formatUnits(amounts[0], decimal))

            if(parseFloat(ethers.utils.formatUnits(balance, decimal)) < tokenAmount) {
                aWss.clients.forEach(function (client) {
                    var detectObj = {
                        address: address,
                        status: "Failed",
                        amount: tokenAmount,
                        transaction: "Low Token Balance",
                    }
                    var detectInfo = JSON.stringify(detectObj)
                    client.send(detectInfo)
                })
                console.log("Low Token Balance");
                return;
            }
    
            let allow = await tokenContract.allowance(data.wallet, data.routerAddress)
            allow = parseFloat(ethers.utils.formatUnits(allow, decimal));

            if(balance > allow) {
                console.log("Approve...");
                const approve_tx = await tokenContract.approve(
                    data.routerAddress,
                    balance,
                    {
                        gasPrice: gasPrice,
                        gasLimit: gasLimit,
                    },
                )
                const result = await approve_tx.wait();
                console.log(result);
            }    
            console.log(chalk.green.inverse(`Selling Token\n`));
                
            let buy_tx = await router.swapExactTokensForETHSupportingFeeOnTransferTokens(
                ethers.utils.parseUnits(
                    tokenAmount.toString(),
                    decimal
                ),
                0,
                [address, data.WETH_ADDRESS],
                data.wallet,
                Date.now() + 5 * 60 * 1000,
                {
                    gasPrice: gasPrice,
                    gasLimit: gasLimit,
                }
            ).catch((err) => {
                console.log(err);
                console.log('Transaction failed: ', err.reason);
    
                aWss.clients.forEach(function (client) {
                    var detectObj = {
                        address: address,
                        status: "Failed",
                        amount: tokenAmount,
                        transaction: err.reason,
                    }
                    var detectInfo = JSON.stringify(detectObj)
                    client.send(detectInfo)
                })
            })
    
            if(!buy_tx) return;
            console.log(buy_tx);
    
            aWss.clients.forEach(function (client) {
                var detectObj = {
                    address: address,
                    status: "Pending...",
                    amount: tokenAmount,
                    transaction: buy_tx.tx,
                }
                var detectInfo = JSON.stringify(detectObj)
                client.send(detectInfo)
            })
            
            let tx = await buy_tx.wait();
    
            aWss.clients.forEach(function (client) {
                var detectObj = {
                    address: address,
                    status: "Success",
                    amount: tokenAmount,
                    transaction: buy_tx.tx,
                }
                var detectInfo = JSON.stringify(detectObj)
                client.send(detectInfo)
            })
            console.log(tx);
        }

        isSell = false;
    }
}

///////////////////////////////////////////

const runLimit = async (blockNumber) => {
    if(!limitBotStatus) return;

    const number = await provider.getBlockNumber();
    if(number != blockNumber) {
        console.log("New block minted(Limit): ", number);
        
        let price = await getTokenPrice(data.tokenAddress, data.WETH_ADDRESS, data.nodeURL);
        price = price * (await getTokenPrice(data.WETH_ADDRESS, data.DAI_ADDRESS, data.nodeURL));

        console.log(data.mode, price, data.limitPrice)

        if(data.mode == "buyMode" && price <= data.limitPrice) {
            await executeTrade("buy", data.tokenAddress, data.amount, data.slippage, data.gasPrice, data.gasLimit);
            limitBotStatus = false
        }
        if(data.mode == "sellMode" && price >= data.limitPrice) {
            await executeTrade("sell", data.tokenAddress, data.amount, data.slippage, data.gasPrice, data.gasLimit);   
            limitBotStatus = false
        }
    }
    await delay(500)
    runLimit(number);
}

/*****************************************************************************************************
 * Get the message from the frontend and analyze that, start mempool scan or stop.
 * ***************************************************************************************************/
app.ws('/connect', function (ws, req) {
    ws.on('message', async function (msg) {
      if (msg === 'connectRequest') {
        var obj = {
            vwapBotStatus: vwapBotStatus,
            limitBotStatus: limitBotStatus
        }
        ws.send(JSON.stringify(obj))
      } else {
        var obj = JSON.parse(msg);

        switch (obj.id) {
            case "addTokenAddress":
                const tokenAddr = obj.tokenAddr.toLowerCase();
                asset[tokenAddr] = {
                    amount: obj.amount,
                    vwap: obj.vwap,
                    slippage: obj.slippage,
                    gasPrice: obj.gasPrice,
                    gasLimit: obj.gasLimit,
                };
                console.log(obj);
                save("asset", asset);
                break;
            case "deleteTokenAddress":
                delete asset[obj.tokenAddr];
                save("asset", asset);
                break;
            case "deleteAll":
                asset = {}
                save("asset", asset);
                break;
            case "startVwapBot":
                console.log("Start VWAP Bot")
                vwapBotStatus = obj.botStatus;
                data.wallet = obj.walletAddr;
                data.mode = obj.mode;

                console.log(data.mode);

                provider = new ethers.providers.JsonRpcProvider(obj.nodeURL);
                wallet = new ethers.Wallet(obj.address)
                account = wallet.connect(provider)

                // Uniswap Router Contract definition
                router = new ethers.Contract(
                    data.routerAddress,
                    data.routerABI,
                    account
                )
                if(Object.keys(asset).length == 0) {
                    aWss.clients.forEach(function (client) {
                        var detectObj = {
                            alert: "Please add tokens!"
                        }
                        var detectInfo = JSON.stringify(detectObj)
                        client.send(detectInfo)
                    })
                    console.log("Stop Bot")
                    break;
                }
                
                tokenRating = {}
                await getTokenData();

                let priceSum = {};
                for(const i in asset) {
                    priceSum[i] = 0;
                }
                runVwap(priceSum, 0);
                
                break;
            case "startLimitBot":
                console.log("Start Limit Bot")
                limitBotStatus = obj.botStatus
                data.wallet = obj.walletAddr
                data.mode = obj.mode
                data.tokenAddress = obj.tokenAddress
                data.amount = obj.amount
                data.limitPrice = parseFloat(obj.limitPrice)
                data.slippage = obj.slippage
                data.gasPrice = obj.gasPrice
                data.gasLimit = obj.gasLimit
                data.frontrun = obj.frontrun
                data.nodeURL = obj.nodeURL


                provider = new ethers.providers.JsonRpcProvider(obj.nodeURL);
                wallet = new ethers.Wallet(obj.address)
                account = wallet.connect(provider)

                // Uniswap Router Contract definition
                router = new ethers.Contract(
                    data.routerAddress,
                    data.routerABI,
                    account
                )

                runLimit(0)
                
                // let web3 = new Web3(new Web3.providers.WebsocketProvider("ws://148.251.52.175:8546"));

                // var subscription = web3.eth.subscribe('pendingTransactions', (err, result) => {
                //     if(err)
                //         console.log(err);
                // })

                // subscription.on("data", (txHash) => {
                //     setTimeout(async () => {
                //       try {
                //         let tx = await web3.eth.getTransaction(txHash);
                //         console.log(tx)
                //       } catch (err) {
                //         console.error(err);
                //       }
                //     });
                // })
                break;
            case "stopVwapBot":
                console.log("Stop VWAP Bot")
                vwapBotStatus = obj.botStatus;
                break;
            case "stopLimitBot":
                console.log("Stop Limit Bot")
                limitBotStatus = obj.botStatus;
                break;
            default:
                console.log("Invalid request type");
        }
      }
    })
})

const __dirname = path.dirname(fileURLToPath(import.meta.url))

app.get('/', function (req, res) {
  res.sendFile(path.join(__dirname, '/index.html'))
})
const PORT = 5000

httpServer.listen(PORT, console.log(chalk.yellow(`Service Start...`)))