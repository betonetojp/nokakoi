namespace nokakoi
{
    public partial class FormEnc : Form
    {
        // コンストラクタ
        public FormEnc()
        {
            InitializeComponent();
            textBoxNokakoiKey.PlaceholderText = NokakoiCrypt.NokakoiTag + " . . .";
        }

        // Encボタン
        private void buttonEnc_Click(object sender, EventArgs e)
        {
            string nsec = textBoxNsec.Text;
            string password = textBoxPassword.Text;
            string nokakoiKey;
            try
            {
                nokakoiKey = NokakoiCrypt.EncryptNokakoiKey(nsec, password);
            }
            catch
            {
                nokakoiKey = "Error.";
            }
            textBoxNokakoiKey.Text = nokakoiKey;
        }
    }
}
