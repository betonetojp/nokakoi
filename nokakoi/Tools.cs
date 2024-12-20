﻿using NBitcoin.Secp256k1;
using NNostr.Client;
using NNostr.Client.JsonConverters;
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
        [JsonPropertyName("mute")]
        public bool Mute { get; set; }
        [JsonPropertyName("last_activity")]
        public DateTime? LastActivity { get; set; }
        [JsonPropertyName("petname")]
        public string? PetName { get; set; }
        [JsonPropertyName("display_name")]
        public string? DisplayName { get; set; }
        [JsonPropertyName("name")]
        public string? Name { get; set; }
        [JsonPropertyName("nip05")]
        public string? Nip05 { get; set; }
        [JsonPropertyName("picture")]
        public string? Picture { get; set; }
        [JsonPropertyName("created_at")]
        [JsonConverter(typeof(UnixTimestampSecondsJsonConverter))]
        public DateTimeOffset? CreatedAt { get; set; }
        //[JsonPropertyName("language")] 
        //public string? Language { get; set; }
    }

    public class Relay
    {
        [JsonPropertyName("enabled")]
        public bool Enabled { get; set; }
        [JsonPropertyName("url")]
        public string? Url { get; set; }
    }

    public static class Tools
    {
        private static readonly string _usersJsonPath = Path.Combine(Application.StartupPath, "users.json");
        private static readonly string _relaysJsonPath = Path.Combine(Application.StartupPath, "relays.json");

        /// <summary>
        /// JSONからユーザーを作成
        /// </summary>
        /// <param name="contentJson">kind:0のcontent JSON</param>
        /// <param name="createdAt">kind:0の作成日時</param>
        /// <returns>ユーザー</returns>
        public static User? JsonToUser(string contentJson, DateTimeOffset? createdAt, bool shouldMuteMostr = true)
        {
            if (string.IsNullOrEmpty(contentJson))
            {
                return null;
            }
            try
            {
                var user = JsonSerializer.Deserialize<User>(contentJson, GetOption());
                if (null != user)
                {
                    user.CreatedAt = createdAt;
                    if (shouldMuteMostr && null != user.Nip05 && user.Nip05.Contains("mostr"))
                    {
                        user.Mute = true;
                    }
                }
                return user;
            }
            catch (JsonException e)
            {
                Debug.WriteLine(e.Message);
                return null;
            }
        }

        public static Relay? JsonToRelay(string json)
        {
            if (string.IsNullOrEmpty(json))
            {
                return null;
            }
            try
            {
                var relay = JsonSerializer.Deserialize<Relay>(json, GetOption());
                return relay;
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
            try
            {
                return nsec.FromNIP19Nsec().CreateXOnlyPubKey().ToNIP19();
            }
            catch (Exception ex)
            {
                Debug.WriteLine(ex.Message);
                return string.Empty;
            }
        }

        /// <summary>
        /// nsecからnpub(HEX)を取得する
        /// </summary>
        /// <param name="nsec">nsec</param>
        /// <returns>npub(HEX)</returns>
        public static string GetNpubHex(this string nsec)
        {
            try
            {
                return nsec.FromNIP19Nsec().CreateXOnlyPubKey().ToHex();
            }
            catch (Exception ex)
            {
                Debug.WriteLine(ex.Message);
                return string.Empty;
            }
        }

        /// <summary>
        /// npubまたはnprofileのpubkeyをHEXに変換する
        /// </summary>
        /// <param name="npubOrNprofile">npub</param>
        /// <returns>HEX</returns>
        public static string ConvertToHex(this string npubOrNprofile)
        {
            try
            {
                // npubが"npub"で始まるとき
                if (npubOrNprofile.StartsWith("npub"))
                {
                    return npubOrNprofile.FromNIP19Npub().ToHex();
                }
                // npubが"nprofile"で始まるとき
                else if (npubOrNprofile.StartsWith("nprofile"))
                {
                    var profile = (NIP19.NosteProfileNote?)npubOrNprofile.FromNIP19Note();
                    if (profile != null)
                    {
                        return profile.PubKey;
                    }
                }
                return string.Empty;
            }
            catch (Exception ex)
            {
                Debug.WriteLine(ex.Message);
                return string.Empty;
            }
        }

        /// <summary>
        /// HEXをnpubに変換する
        /// </summary>
        /// <param name="hex">HEX</param>
        /// <returns>npub</returns>
        public static string ConvertToNpub(this string hex)
        {
            try
            {
                return ECXOnlyPubKey.Create(hex.FromHex()).ToNIP19();
            }
            catch (Exception ex)
            {
                Debug.WriteLine(ex.Message);
                return string.Empty;
            }
        }

        /// <summary>
        /// ユーザー辞書をファイルに保存する
        /// </summary>
        /// <param name="users">ユーザー辞書</param>
        internal static void SaveUsers(Dictionary<string, User?> users)
        {
            // users.jsonに保存
            try
            {
                var jsonContent = JsonSerializer.Serialize(users, GetOption());
                File.WriteAllText(_usersJsonPath, jsonContent);
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
            if (!File.Exists(_usersJsonPath))
            {
                return [];
            }
            try
            {
                var jsonContent = File.ReadAllText(_usersJsonPath);
                var users = JsonSerializer.Deserialize<Dictionary<string, User?>>(jsonContent, GetOption());
                if (users != null)
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

        internal static void SaveRelays(List<Relay> relays)
        {
            // relays.jsonに保存
            try
            {
                var jsonContent = JsonSerializer.Serialize(relays, GetOption());
                File.WriteAllText(_relaysJsonPath, jsonContent);
            }
            catch (JsonException e)
            {
                Debug.WriteLine(e.Message);
            }
        }

        internal static List<Relay> LoadRelays()
        {
            List<Relay> defaultRelays = [
                new Relay { Enabled = true, Url = "wss://yabu.me/" },
                new Relay { Enabled = true, Url = "wss://r.kojira.io/" },
                new Relay { Enabled = true, Url = "wss://relay-jp.nostr.wirednet.jp/" },
                new Relay { Enabled = true, Url = "wss://nos.lol/" },
                new Relay { Enabled = true, Url = "wss://relay.damus.io/" },
                new Relay { Enabled = true, Url = "wss://relay.nostr.band/" },
                ];

            // relays.jsonを読み込み
            if (!File.Exists(_relaysJsonPath))
            {
                return defaultRelays;
            }
            try
            {
                var jsonContent = File.ReadAllText(_relaysJsonPath);
                var relays = JsonSerializer.Deserialize<List<Relay>>(jsonContent, GetOption());
                if (relays != null)
                {
                    return relays;
                }
                return [];
            }
            catch (JsonException e)
            {
                Debug.WriteLine(e.Message);
                return [];
            }
        }

        internal static Uri[] GetEnabledRelays()
        {
            return GetEnabledRelays(LoadRelays());
        }

        internal static Uri[] GetEnabledRelays(List<Relay> relays)
        {
            List<Uri> enabledRelays = [];
            foreach (var relay in relays)
            {
                if (relay.Enabled && relay.Url != null)
                {
                    enabledRelays.Add(new Uri(relay.Url));
                }
            }
            return [.. enabledRelays];
        }
    }
}
