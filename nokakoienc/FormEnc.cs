namespace nokakoi
{
    public partial class FormEnc : Form
    {
        // �R���X�g���N�^
        public FormEnc()
        {
            InitializeComponent();
            textBoxNokakoiKey.PlaceholderText = NokakoiCrypt.NokakoiTag + " . . .";
        }

        // Enc�{�^��
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
