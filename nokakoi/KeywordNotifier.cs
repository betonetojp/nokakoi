using nokakoi.Properties;
using System.Diagnostics;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Unicode;

namespace nokakoi
{
    public class NotifierSettings
    {
        [JsonPropertyName("keywords")]
        public List<string> Keywords { get; set; } = [];
        [JsonPropertyName("balloon")]
        public bool Balloon { get; set; }
        [JsonPropertyName("open_file")]
        public bool Open { get; set; }
        [JsonPropertyName("file_name")]
        public string FileName { get; set; } = string.Empty;
    }

    public class KeywordNotifier
    {
        public NotifierSettings Settings = new();

        private readonly List<string> _keywords = [];
        private readonly bool _shouldShowBalloon = true;
        private readonly bool _shouldOpenFile = false;
        private readonly string _fileName = "https://njump.me/";

        private readonly NotifyIcon _notifyIcon;
        private readonly string _jsonPath = "keywords.json";
        private readonly JsonSerializerOptions _options = new()
        {
            Encoder = JavaScriptEncoder.Create(UnicodeRanges.All),
            WriteIndented = true,
        };

        public KeywordNotifier()
        {
            _notifyIcon = new NotifyIcon()
            {
                Icon = Resources.nokakoi
            };

            if (File.Exists(_jsonPath))
            {
                try
                {
                    var jsonContent = File.ReadAllText(_jsonPath);
                    var notifierSettings = JsonSerializer.Deserialize<NotifierSettings>(jsonContent, _options);
                    if (notifierSettings != null)
                    {
                        _keywords = notifierSettings.Keywords;
                        _shouldShowBalloon = notifierSettings.Balloon;
                        _shouldOpenFile = notifierSettings.Open;
                        _fileName = notifierSettings.FileName;
                    }
                }
                catch (Exception ex)
                {
                    Debug.WriteLine(ex.Message);
                }
            }

            Settings = new NotifierSettings()
            {
                Keywords = _keywords,
                Balloon = _shouldShowBalloon,
                Open = _shouldOpenFile,
                FileName = _fileName
            };
            SaveSettings();
        }

        public void SaveSettings()
        {
            try
            {
                var jsonContent = JsonSerializer.Serialize(Settings, _options);
                File.WriteAllText(_jsonPath, jsonContent);
            }
            catch (Exception ex)
            {
                Debug.WriteLine(ex.Message);
            }
        }

        public bool CheckPost(string post)
        {
            foreach (var keyword in _keywords)
            {
                if (post.Contains(keyword))
                {
                    if (_shouldShowBalloon)
                    {
                        _notifyIcon.Visible = true;
                        _notifyIcon.BalloonTipTitle = "Keyword Notifier : " + keyword;
                        _notifyIcon.BalloonTipText = post;
                        _notifyIcon.ShowBalloonTip(3000);
                        _notifyIcon.Visible = false;
                    }
                    return true;
                }
            }
            return false;
        }
    }
}