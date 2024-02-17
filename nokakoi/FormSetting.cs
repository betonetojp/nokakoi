using System.Diagnostics;

namespace nokakoi
{
    public partial class FormSetting : Form
    {
        public FormSetting()
        {
            InitializeComponent();
            textBoxNokakoiKey.PlaceholderText = NokakoiCrypt.NokakoiTag + " . . .";
        }

        private void trackBarOpacity_Scroll(object sender, EventArgs e)
        {
            if (null != Owner)
            {
                Owner.Opacity = trackBarOpacity.Value / 100.0;
            }
        }

        private void linkLabelIcons8_LinkClicked(object sender, LinkLabelLinkClickedEventArgs e)
        {
            linkLabelIcons8.LinkVisited = true;

            var app = new ProcessStartInfo();
            app.FileName = "https://icons8.com";
            app.UseShellExecute = true;

            Process.Start(app);
        }
    }
}
