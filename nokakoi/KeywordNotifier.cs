using nokakoi.Properties;
using System.Diagnostics;
using System.Text.Json;
using System.Windows.Forms;

namespace nokakoi
{
    public class KeywordNotifier
    {
        private readonly List<string> _keywords;
        private readonly NotifyIcon _notifyIcon;

        public KeywordNotifier()
        {
            _keywords = [];
            _notifyIcon = new NotifyIcon()
            {
                Icon = Resources.nokakoi
            };

            var jsonPath = "keywords.json";
            if (File.Exists(jsonPath))
            {
                var json = File.ReadAllText(jsonPath);
                try
                {
                    var data = JsonSerializer.Deserialize<Dictionary<string, List<string>>>(json);
                    if (data != null)
                    {
                        _keywords = data["keywords"];
                    }
                }
                catch (Exception ex)
                {
                    Debug.WriteLine(ex.Message);
                }
            }
        }

        public void CheckPost(string userName, string post)
        {
            foreach (var keyword in _keywords)
            {
                if (post.Contains(keyword))
                {
                    _notifyIcon.Visible = true;
                    _notifyIcon.BalloonTipTitle = userName;
                    _notifyIcon.BalloonTipText = post;
                    _notifyIcon.ShowBalloonTip(3000);
                    _notifyIcon.Visible = false;
                }
            }
        }
    }
}