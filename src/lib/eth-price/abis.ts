import { parseAbi } from "viem"

export const uniswapV3FactoryAbi = parseAbi([
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)",
])

export const uniswapV3PoolAbi = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
  "function observe(uint32[] secondsAgos) view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
])

export const uniswapV2FactoryAbi = parseAbi([
  "function getPair(address tokenA, address tokenB) view returns (address pair)",
])

export const uniswapV2PairAbi = parseAbi([
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "event Sync(uint112 reserve0, uint112 reserve1)",
])

export const uniswapV1FactoryAbi = parseAbi([
  "function getExchange(address token) view returns (address exchange)",
])

export const uniswapV1ExchangeAbi = parseAbi([
  "function tokenAddress() view returns (address)",
  "function factoryAddress() view returns (address)",
])

export const erc20Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
])

/** MakerDAO Multicall v1. aggregate() is non-view on-chain; eth_call doesn't care. */
export const multicall1Abi = parseAbi([
  "function aggregate((address target, bytes callData)[] calls) view returns (uint256 blockNumber, bytes[] returnData)",
  "function getCurrentBlockTimestamp() view returns (uint256 timestamp)",
  "function getEthBalance(address addr) view returns (uint256 balance)",
])
