using NBitcoin.Secp256k1;
using NNostr.Client;
using NNostr.Client.Protocols;

namespace nokakoi
{
    public static class Tools
    {
        /// <summary>
        /// nsecからnpubを取得する
        /// </summary>
        /// <param name="nsec">nsec</param>
        /// <returns>npub</returns>
        public static string GetNpub(this string nsec)
        {
            return nsec.FromNIP19Nsec().CreateXOnlyPubKey().ToNIP19();
        }

        /// <summary>
        /// npubをHEXに変換する
        /// </summary>
        /// <param name="npub">npub</param>
        /// <returns>HEX</returns>
        public static string ConvertToHex(this string npub)
        {
            return npub.FromNIP19Npub().ToHex();
        }

        /// <summary>
        /// HEXをnpubに変換する
        /// </summary>
        /// <param name="hex">HEX</param>
        /// <returns>npub</returns>
        public static string ConvertToNpub(this string hex)
        {
            return ECXOnlyPubKey.Create(hex.FromHex()).ToNIP19();
        }
    }
}
