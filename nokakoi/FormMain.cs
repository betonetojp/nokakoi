using NNostr.Client;
using NNostr.Client.Protocols;
using NTextCat;
using System.Text.RegularExpressions;

namespace nokakoi
{
    public partial class FormMain : Form
    {
        private static TimeSpan _timeSpan = new(0, 0, 0, 0);
        private FormSetting _formSetting = new();
        private NostrClient? _client;
        private static string _subscriptionId = string.Empty;
        private static string _nsec = string.Empty;

        private static int _cutLength;
        private static bool _displayTime;
        private static bool _addShortcode;
        private static string _shortcode = string.Empty;
        private static string _emojiUrl = string.Empty;
        private static bool _addClient;
        private static bool _showOnlyTagged;
        private static bool _showOnlyJapanese;
        private static string _nokakoiKey = string.Empty;
        private static string _password = string.Empty;

        private static double _tempOpacity = 1.00;

        #region �R���X�g���N�^
        // �R���X�g���N�^
        public FormMain()
        {
            InitializeComponent();

            Setting.Load("nokakoi.config");

            Location = Setting.Location;
            Size = Setting.Size;
            textBoxRelay.Text = Setting.Relay;
            TopMost = Setting.TopMost;
            _cutLength = Setting.CutLength;
            Opacity = Setting.Opacity;
            if (0 == Opacity) { Opacity = 1; }
            _displayTime = Setting.DisplayTime;
            _addShortcode = Setting.AddShortcode;
            _shortcode = Setting.Shortcode;
            _emojiUrl = Setting.EmojiUrl;
            _addClient = Setting.AddClient;
            _showOnlyTagged = Setting.ShowOnlyTagged;
            _showOnlyJapanese = Setting.ShowOnlyJapanese;
            _nokakoiKey = Setting.NokakoiKey;
        }
        #endregion

        #region Connect�{�^��
        // Connect�{�^��
        private void buttonConnect_Click(object sender, EventArgs e)
        {
            _subscriptionId = Guid.NewGuid().ToString("N");

            _ = ConnectAsync();

            textBoxRelay.ForeColor = SystemColors.GrayText;
            buttonConnect.Enabled = false;
            buttonStart.Enabled = true;
            buttonStart.Focus();
            textBoxTimeline.Text = string.Empty;
        }
        #endregion

        #region �ڑ�����
        // �ڑ�����
        private async Task ConnectAsync()
        {
            _client = new NostrClient(new Uri(textBoxRelay.Text));

            await _client.Connect();

            textBoxTimeline.Text = "> Connect." + Environment.NewLine + textBoxTimeline.Text;
        }
        #endregion

        #region Start�{�^��
        // Start�{�^��
        private void buttonStart_Click(object sender, EventArgs e)
        {
            _ = StartAsync();

            buttonStart.Enabled = false;
            buttonStop.Enabled = true;
            buttonStop.Focus();
            buttonPost.Enabled = true;
        }
        #endregion

        #region �w�ǊJ�n
        // �w�ǊJ�n
        private async Task StartAsync()
        {
            if (null == _client)
            {
                return;
            }

            //subscribe to all kind 1 events under the subscription id of _subscriptionId
            await _client.CreateSubscription(
                    _subscriptionId,
                    [new NostrSubscriptionFilter()
                        {
                            Kinds = [1],
                            Since = DateTimeOffset.Now - _timeSpan,
                        }
                    ]
                );

            textBoxTimeline.Text = "> Create subscription." + Environment.NewLine + textBoxTimeline.Text;

            _client.EventsReceived += OnClientOnEventsReceived;
        }
        #endregion

        #region �C�x���g���b�X��
        // �C�x���g���b�X��
        private void OnClientOnEventsReceived(object? sender, (string subscriptionId, NostrEvent[] events) args)
        {
            if (args.subscriptionId == _subscriptionId)
            {
                foreach (var nostrEvent in args.events)
                {
                    var c = nostrEvent.GetTaggedData("client");
                    var iSnokakoi = -1 < Array.IndexOf(c, "nokakoi");

                    if (_showOnlyTagged && !iSnokakoi)
                    {
                        // nokakoi����\���I����nokakoi����Ȃ����͕\�����Ȃ�
                        continue;
                    }

                    var content = nostrEvent.Content;
                    if (content != null)
                    {
                        if (_showOnlyJapanese)
                        {
                            // ���{�����\���I���̎�
                            if ("jpn" != DetermineLanguage(content))
                            {
                                continue;
                            }
                        }

                        content = Regex.Unescape(content);
                        content = content.Replace('\n', ' ');
                        if (content.Length > _cutLength)
                        {
                            content = $"{content[.._cutLength]} . . .";
                        }
                    }
                    DateTimeOffset time;
                    int hour;
                    int minute;
                    string timeString = "- ";
                    if (nostrEvent.CreatedAt != null)
                    {
                        time = (DateTimeOffset)nostrEvent.CreatedAt;
                        time = time.LocalDateTime;
                        hour = time.Hour;
                        minute = time.Minute;
                        timeString = string.Format("{0:D2}", hour) + ":" + string.Format("{0:D2}", minute);
                    }

                    textBoxTimeline.Text = (iSnokakoi ? "*" : "-") + (_displayTime ? timeString : string.Empty)
                                         + " " + content + Environment.NewLine + textBoxTimeline.Text;
                }
            }
        }
        #endregion

        #region Stop�{�^��
        // Stop�{�^��
        private void buttonStop_Click(object sender, EventArgs e)
        {
            if (null == _client)
            {
                return;
            }

            _client.CloseSubscription(_subscriptionId);
            textBoxTimeline.Text = "> Close subscription." + Environment.NewLine + textBoxTimeline.Text;
            _client.Disconnect();
            textBoxTimeline.Text = "> Disconnect." + Environment.NewLine + textBoxTimeline.Text;
            _client.Dispose();
            textBoxTimeline.Text = "> Finish." + Environment.NewLine + textBoxTimeline.Text;

            textBoxRelay.ForeColor = SystemColors.WindowText;
            buttonConnect.Enabled = true;
            buttonConnect.Focus();
            buttonStop.Enabled = false;
            buttonPost.Enabled = false;
        }
        #endregion

        #region Post�{�^��
        // Post�{�^��
        private void buttonPost_Click(object sender, EventArgs e)
        {
            if (0 == _formSetting.textBoxNokakoiKey.TextLength || 0 == _formSetting.textBoxPassword.TextLength)
            {
                textBoxTimeline.Text = "> Please set noskoi-key and password." + Environment.NewLine + textBoxTimeline.Text;
                return;
            }
            if (0 == textBoxPost.TextLength)
            {
                textBoxTimeline.Text = "> Cannot post empty." + Environment.NewLine + textBoxTimeline.Text;
                return;
            }

            _ = PostAsync();

            textBoxPost.Text = string.Empty;
            textBoxPost.Focus();
        }
        #endregion

        #region ���e����
        // ���e����
        private async Task PostAsync()
        {
            if (null == _client)
            {
                return;
            }

            // load from an nsec string
            var key = _nsec.FromNIP19Nsec();
            List<NostrEventTag> tags =
            [
                new NostrEventTag() { TagIdentifier = "client", Data = ["nokakoi"] },
                new NostrEventTag() { TagIdentifier = "emoji", Data = [$"{_shortcode}", $"{_emojiUrl}"] }
            ];
            // create a new event
            var newEvent = new NostrEvent()
            {
                Kind = 1,
                Content = textBoxPost.Text + (_addShortcode ? " :" + _shortcode + ":" : string.Empty),
                //Tags = [new NostrEventTag() { TagIdentifier = "client", Data = ["nokakoi"] }],
                Tags = tags
            };
            // sign the event
            await newEvent.ComputeIdAndSignAsync(key);
            // send the event
            await _client.SendEventsAndWaitUntilReceived([newEvent], CancellationToken.None);
        }
        #endregion

        #region Setting�{�^��
        // Setting�{�^��
        private void buttonSetting_Click(object sender, EventArgs e)
        {
            // �J���O
            _formSetting.checkBoxTopMost.Checked = TopMost;
            _formSetting.textBoxCutLength.Text = _cutLength.ToString();
            _formSetting.trackBarOpacity.Value = (int)(Opacity * 100);
            _formSetting.checkBoxDisplayTime.Checked = _displayTime;
            _formSetting.checkBoxAddEndTag.Checked = _addShortcode;
            _formSetting.textBoxShortcode.Text = _shortcode;
            _formSetting.textBoxEmojiUrl.Text = _emojiUrl;
            _formSetting.checkBoxAddClient.Checked = _addClient;
            _formSetting.checkBoxShowOnlyTagged.Checked = _showOnlyTagged;
            _formSetting.checkBoxShowOnlyJapanese.Checked = _showOnlyJapanese;
            _formSetting.textBoxNokakoiKey.Text = _nokakoiKey;
            _formSetting.textBoxPassword.Text = _password;

            // �J��
            _formSetting.ShowDialog(this);

            // ������
            TopMost = _formSetting.checkBoxTopMost.Checked;
            if (!int.TryParse(_formSetting.textBoxCutLength.Text, out _cutLength))
            {
                _cutLength = 20;
            }
            else if (_cutLength < 1)
            {
                _cutLength = 1;
            }
            Opacity = _formSetting.trackBarOpacity.Value / 100.0;
            _displayTime = _formSetting.checkBoxDisplayTime.Checked;
            _addShortcode = _formSetting.checkBoxAddEndTag.Checked;
            _shortcode = _formSetting.textBoxShortcode.Text;
            _emojiUrl = _formSetting.textBoxEmojiUrl.Text;
            _addClient = _formSetting.checkBoxAddClient.Checked;
            _showOnlyTagged = _formSetting.checkBoxShowOnlyTagged.Checked;
            _showOnlyJapanese = _formSetting.checkBoxShowOnlyJapanese.Checked;
            _nokakoiKey = _formSetting.textBoxNokakoiKey.Text;
            _password = _formSetting.textBoxPassword.Text;
            try
            {
                _nsec = NokakoiCrypt.DecryptNokakoiKey(_nokakoiKey, _password);
            }
            catch (Exception)
            {
                MessageBox.Show("Decryption failed.");
            }

            Setting.TopMost = TopMost;
            Setting.CutLength = _cutLength;
            Setting.Opacity = Opacity;
            Setting.DisplayTime = _displayTime;
            Setting.AddShortcode = _addShortcode;
            Setting.Shortcode = _shortcode;
            Setting.EmojiUrl = _emojiUrl;
            Setting.AddClient = _addClient;
            Setting.ShowOnlyTagged = _showOnlyTagged;
            Setting.ShowOnlyJapanese = _showOnlyJapanese;
            Setting.NokakoiKey = _nokakoiKey;

            Setting.Save("nokakoi.config");
        }
        #endregion

        #region ������������
        // �}�E�X��������
        private void textBoxTimeline_MouseEnter(object sender, EventArgs e)
        {
            _tempOpacity = Opacity;
            Opacity = 1.00;
        }

        // �}�E�X�o����
        private void textBoxTimeline_MouseLeave(object sender, EventArgs e)
        {
            Opacity = _tempOpacity;
        }
        #endregion

        #region ���ꔻ��
        // ���ꔻ��
        private static string DetermineLanguage(string text)
        {
            var factory = new RankedLanguageIdentifierFactory();
            RankedLanguageIdentifier identifier;
            try
            {
                identifier = factory.Load("Core14.profile.xml");
            }
            catch (Exception)
            {
                return string.Empty;
            }
            var languages = identifier.Identify(text);
            var mostCertainLanguage = languages.FirstOrDefault();
            if (mostCertainLanguage != null)
            {
                return mostCertainLanguage.Item1.Iso639_3;
            }
            else
            {
                return string.Empty;
            }
        }
        #endregion

        #region ����
        // ����
        private void FormMain_FormClosing(object sender, FormClosingEventArgs e)
        {
            Setting.Location = Location;
            Setting.Size = Size;
            Setting.Relay = textBoxRelay.Text;

            Setting.Save("nokakoi.config");
        }
        #endregion
    }
}
