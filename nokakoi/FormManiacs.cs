namespace nokakoi
{
    public partial class FormManiacs : Form
    {
        internal FormMain? MainForm { get; set; }
        public FormManiacs()
        {
            InitializeComponent();
        }

        private void FormUsers_Load(object sender, EventArgs e)
        {
            if (MainForm != null)
            {
                foreach (var user in MainForm.Users)
                {
                    dataGridViewUsers.Rows.Add(user.Value?.Mute, user.Value?.DisplayName, user.Value?.Name, user.Value?.Nip05, user.Key);
                }
                dataGridViewUsers.ClearSelection();
                var settings = MainForm.Notifier.Settings;
                checkBoxBalloon.Checked = settings.Balloon;
                checkBoxOpenFile.Checked = settings.Open;
                textBoxFileName.Text = settings.FileName;
                textBoxKeywords.Text = string.Join("\r\n", settings.Keywords);
            }
        }

        private void ButtonSave_Click(object sender, EventArgs e)
        {
            if (MainForm != null)
            {
                foreach (DataGridViewRow row in dataGridViewUsers.Rows)
                {
                    if (row.Cells[4].Value != null)
                    {
                        var key = row.Cells[4].Value.ToString();
                        if (key != null && MainForm.Users.TryGetValue(key, out User? user))
                        {
                            if (user != null)
                            {
                                user.Mute = (bool)row.Cells[0].Value;
                            }
                        }
                    }
                }
                var settings = MainForm.Notifier.Settings;
                settings.Balloon = checkBoxBalloon.Checked;
                settings.Open = checkBoxOpenFile.Checked;
                settings.FileName = textBoxFileName.Text;
                settings.Keywords = [.. textBoxKeywords.Text.Split(["\r\n"], StringSplitOptions.RemoveEmptyEntries)];
            }
            Close();
        }

        private void FormManiacs_FormClosing(object sender, FormClosingEventArgs e)
        {
            if (MainForm != null)
            {
                Tools.SaveUsers(MainForm.Users);
                MainForm.Notifier.SaveSettings();
                MainForm.Users = Tools.LoadUsers();
                MainForm.Notifier = new KeywordNotifier();
            }
        }

        private void dataGridViewUsers_SelectionChanged(object sender, EventArgs e)
        {
            //dataGridViewUsers.ClearSelection();
        }
    }
}
