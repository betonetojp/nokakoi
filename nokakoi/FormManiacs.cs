using Microsoft.VisualBasic.ApplicationServices;

namespace nokakoi
{
    public partial class FormManiacs : Form
    {
        internal FormMain? _formMain;
        public FormManiacs()
        {
            InitializeComponent();
        }

        private void FormUsers_Load(object sender, EventArgs e)
        {
            if (_formMain != null)
            {
                foreach (var user in _formMain.Users)
                {
                    dataGridViewUsers.Rows.Add(user.Value?.Mute, user.Value?.DisplayName, user.Value?.Name, user.Value?.Nip05, user.Key);
                }
                checkBoxBalloon.Checked = _formMain.Notifier.Settings.Balloon;
                checkBoxOpenFile.Checked = _formMain.Notifier.Settings.Open;
                textBoxFileName.Text = _formMain.Notifier.Settings.FileName;
                textBoxKeywords.Text = string.Join("\r\n", _formMain.Notifier.Settings.Keywords);
            }
        }

        private void ButtonSave_Click(object sender, EventArgs e)
        {
            if (_formMain != null)
            {
                foreach (DataGridViewRow row in dataGridViewUsers.Rows)
                {
                    if (row.Cells[4].Value != null)
                    {
                        var key = row.Cells[4].Value.ToString();
                        if (key != null && _formMain.Users.TryGetValue(key, out User? user))
                        {
                            if (user != null)
                            {
                                user.Mute = (bool)row.Cells[0].Value;
                            }
                        }
                    }
                }
                _formMain.Notifier.Settings.Balloon = checkBoxBalloon.Checked;
                _formMain.Notifier.Settings.Open = checkBoxOpenFile.Checked;
                _formMain.Notifier.Settings.FileName = textBoxFileName.Text;
                _formMain.Notifier.Settings.Keywords = [.. textBoxKeywords.Text.Split(["\r\n"], StringSplitOptions.RemoveEmptyEntries)];
            }
            Close();
        }

        private void FormManiacs_FormClosing(object sender, FormClosingEventArgs e)
        {
            if (_formMain != null)
            {
                Tools.SaveUsers(_formMain.Users);
                _formMain.Notifier.SaveSettings();
                _formMain.Users = Tools.LoadUsers();
                _formMain.Notifier = new KeywordNotifier();
            }
        }
    }
}
