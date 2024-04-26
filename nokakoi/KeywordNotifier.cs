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
        public bool Balloon { get; set; } = true;
        [JsonPropertyName("open_file")]
        public bool Open { get; set; } = false;
        [JsonPropertyName("file_name")]
        public string FileName { get; set; } = "https://njump.me/";
    }

    public class KeywordNotifier
    {
        private readonly NotifyIcon _notifyIcon;
        private readonly List<string> _keywords = [];
        private readonly bool _shouldShowBalloon = true;
        public bool ShouldOpenFile { get; set; } = false;
        public string FileName { get; set; } = "https://njump.me/";

        public KeywordNotifier()
        {
            _notifyIcon = new NotifyIcon()
            {
                Icon = Resources.nokakoi
            };
            NotifierSettings? notifierSettings;
            var jsonPath = "keywords.json";
            var options = new JsonSerializerOptions
            {
                Encoder = JavaScriptEncoder.Create(UnicodeRanges.All),
                WriteIndented = true,
            };

            if (File.Exists(jsonPath))
            {
                try
                {
                    var jsonContent = File.ReadAllText(jsonPath);
                    notifierSettings = JsonSerializer.Deserialize<NotifierSettings>(jsonContent, options);
                    if (notifierSettings != null)
                    {
                        _keywords = notifierSettings.Keywords;
                        _shouldShowBalloon = notifierSettings.Balloon;
                        ShouldOpenFile = notifierSettings.Open;
                        FileName = notifierSettings.FileName;
                    }
                }
                catch (Exception ex)
                {
                    Debug.WriteLine(ex.Message);
                }
            }

            notifierSettings = new NotifierSettings()
            {
                Keywords = _keywords,
                Balloon = _shouldShowBalloon,
                Open = ShouldOpenFile,
                FileName = FileName
            };

            try
            {
                var jsonContent = JsonSerializer.Serialize(notifierSettings, options);
                File.WriteAllText(jsonPath, jsonContent);
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