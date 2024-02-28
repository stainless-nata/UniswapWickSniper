import Web3 from 'web3';

const getTokenPrice = async (fromAddress, toAddress, nodeURL) => {
    try {
        let web3 = new Web3(nodeURL);
        const router = new web3.eth.Contract([
            {
                "inputs":
                [
                    {
                        "internalType":"uint256",
                        "name":"amountIn",
                        "type":"uint256"
                    },
                    {
                        "internalType":"address[]",
                        "name":"path",
                        "type":"address[]"
                    }
                ],
                "name":"getAmountsOut",
                "outputs":
                [
                    {
                        "internalType":"uint256[]",
                        "name":"amounts",
                        "type":"uint256[]"
                    }
                ],
                "stateMutability":"view",
                "type":"function"
            }
        ],'0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D')

        const token = new web3.eth.Contract([
            {"inputs":[],"name":"decimals","outputs":[{"internalType":"uint8","name":"","type":"uint8"}],"stateMutability":"view","type":"function"}
        ], fromAddress)
        let decimal = parseInt(await token.methods.decimals().call());

        let price = (await router.methods.getAmountsOut(10 ** (decimal - 3), [
            fromAddress,
            toAddress,
        ]).call())[1];

        price = parseInt(price) / 1e15

        return price;
    } catch (e) {
        console.log("Error in Get Token Price: ", e)
    }
}

export default getTokenPrice;