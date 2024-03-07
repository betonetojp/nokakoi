﻿using System.Diagnostics;

namespace nokakoi
{
    public partial class FormSetting : Form
    {
        public FormSetting()
        {
            InitializeComponent();
            textBoxNokakoiKey.PlaceholderText = NokakoiCrypt.NokakoiTag + " . . .";
        }

        private void FormSetting_Load(object sender, EventArgs e)
        {
            labelOpacity.Text = $"{trackBarOpacity.Value}%";
        }

        private void trackBarOpacity_Scroll(object sender, EventArgs e)
        {
            labelOpacity.Text = $"{trackBarOpacity.Value}%";
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

        private void FormSetting_KeyPress(object sender, KeyPressEventArgs e)
        {
            if (e.KeyChar == (char)Keys.Escape)
            {
                Close();
            }
        }
    }
}
