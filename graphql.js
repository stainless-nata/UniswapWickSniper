import { bitqueryUrl } from './config.js'
import fetch from 'node-fetch'

const fetchGraphQL = async (query) => {
  // Fetch data from GraphQL API:
  const response = await fetch(bitqueryUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
        "X-API-KEY": "BQYHJxhtk2FYf0yDucke9O4wNaT8qJiS"
    },
    body: JSON.stringify({
      query
    })
  }).catch(console.error);

  let res = (await response.json()).data.EVM;

  return res;
}

const QueryType = (address, time) => {
  return `
  {
    EVM(dataset: combined, network: eth) {
      buyside: DEXTrades(
        orderBy: {ascending: Block_Time}
        where: {Trade: {Buy: {Currency: {SmartContract: {is: "${address}"}}}}, Block: {Time: {since: "${time}"}}}
      ) {
        Trade {
          Buy {
            Price
            Currency {
              SmartContract
            }
          }
          Sell {
            Amount
            Currency {
              SmartContract
            }
          }
        }
      }
      sellside: DEXTrades(
        orderBy: {ascending: Block_Time}
        where: {Trade: {Sell: {Currency: {SmartContract: {is: "${address}"}}}}, Block: {Time: {since: "${time}"}}}
      ) {
        Trade {
          Buy {
            Amount
            Currency {
              SmartContract
            }
          }
          Sell {
            Price
            Currency {
              SmartContract
            }
          }
        }
      }
    }
  }  
  `;
}
export {
    fetchGraphQL,
    QueryType,
}

/*
{
  ethereum(network: ethereum) {
    dexTrades(
      baseCurrency: {is: "0x6982508145454ce325ddbe47a25d4ec3d2311933"}
      quoteCurrency: {is: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"}
      time: {after: "2023-05-20T00:00:00Z",}
    ) {
        timeInterval {
          second(count: 15, format: "%FT%TZ")
        }
      volume: tradeAmount(in: USD)
    }
  }
}
    {
      ethereum(network: ethereum) {
        dexTrades(
          exchangeName: {is: "Uniswap"}
          baseCurrency: {is: "0x6982508145454ce325ddbe47a25d4ec3d2311933"}
          quoteCurrency: {is: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"}
          time: {after: "2023-05-20T06:22:04.332Z", before: "2023-05-20T07:22:16.740Z"}
        ) {
          volume: tradeAmount(in: USD)
        }
      }
    }

{
EVM(dataset: combined, network: eth) {
  buyside: DEXTrades(where: {}) {
    Transaction {
      Hash
    }
    Trade {
      Buy {
        Amount
        Currency {
          Name
          Symbol
          SmartContract
        }
        Price
      }
      Sell {
        Amount
        Currency {
          Name
          SmartContract
          Symbol
        }
        Seller
        Price
      }
    }
  }
  sellside: DEXTrades(
    where: {Trade: {Buy: {Currency: {SmartContract: {is: "0x6982508145454ce325ddbe47a25d4ec3d2311933"}}}}, Block: {Time: {since: "2023-05-20T11:30:00Z"}}}
  ) {
    Transaction {
      From
      To
      Hash
    }
    Trade {
      Buy {
        Amount
        Buyer
        Currency {
          Name
          Symbol
          SmartContract
        }
        Seller
        Price
      }
      Sell {
        Amount
        Buyer
        Currency {
          Name
          SmartContract
          Symbol
        }
        Seller
        Price
      }
    }
  }
}
}
   
*/