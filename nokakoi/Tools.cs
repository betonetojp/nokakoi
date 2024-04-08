using NBitcoin.Secp256k1;
using NNostr.Client;
using NNostr.Client.Protocols;
using System.Diagnostics;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Unicode;

namespace nokakoi
{
    public class User
    {
        [JsonPropertyName("name")]
        public string? Name { get; set; }
        [JsonPropertyName("display_name")]
        public string? DisplayName { get; set; }
        /* 今は使わないので削除
        [JsonPropertyName("nip05")]
        public string? Nip05 { get; set; }
        [JsonPropertyName("picture")]
        public string? Picture { get; set; }
        */
        [JsonPropertyName("mute")]
        public bool Mute { get; set; }
    }

    public static class Tools
    {
        /// <summary>
        /// JSONからユーザーを作成
        /// </summary>
        /// <param name="json">kind:0のcontent JSON</param>
        /// <returns>ユーザー</returns>
        public static User? JsonToUser(string json)
        {
            if (string.IsNullOrEmpty(json))
            {
                return null;
            }
            try
            {
                var user = JsonSerializer.Deserialize<User>(json, GetOption());
                return user;
            }
            catch (JsonException e)
            {
                Debug.WriteLine(e.Message);
                return null;
            }
        }

        private static JsonSerializerOptions GetOption()
        {
            // ユニコードのレンジ指定で日本語も正しく表示、インデントされるように指定
            var options = new JsonSerializerOptions
            {
                Encoder = JavaScriptEncoder.Create(UnicodeRanges.All),
                WriteIndented = true,
            };
            return options;
        }

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
        /// nsecからnpub(HEX)を取得する
        /// </summary>
        /// <param name="nsec">nsec</param>
        /// <returns>npub(HEX)</returns>
        public static string GetNpubHex(this string nsec)
        {
            return nsec.FromNIP19Nsec().CreateXOnlyPubKey().ToHex();
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

        /// <summary>
        /// ユーザー辞書をファイルに保存する
        /// </summary>
        /// <param name="users">ユーザー辞書</param>
        internal static void SaveUsers(Dictionary<string, User?> users)
        {
            // users.jsonに保存
            var filePath = "users.json";
            try
            {
                var jsonContent = JsonSerializer.Serialize(users, GetOption());
                File.WriteAllText(filePath, jsonContent);
            }
            catch (JsonException e)
            {
                Debug.WriteLine(e.Message);
            }
        }

        /// <summary>
        /// ファイルからユーザー辞書を読み込む
        /// </summary>
        /// <returns>ユーザー辞書</returns>
        internal static Dictionary<string, User?> LoadUsers()
        {
            // users.jsonを読み込み
            var filePath = "users.json";
            if (!File.Exists(filePath))
            {
                return [];
            }
            try
            {
                var jsonContent = File.ReadAllText(filePath);
                var users = JsonSerializer.Deserialize<Dictionary<string, User?>>(jsonContent, GetOption());
                if (null != users)
                {
                    return users;
                }
                return [];
            }
            catch (JsonException e)
            {
                Debug.WriteLine(e.Message);
                return [];
            }
        }
    }
}
