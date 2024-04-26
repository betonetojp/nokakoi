namespace nokakoi
{
    partial class FormPostBar
    {
        /// <summary>
        /// Required designer variable.
        /// </summary>
        private System.ComponentModel.IContainer components = null;

        /// <summary>
        /// Clean up any resources being used.
        /// </summary>
        /// <param name="disposing">true if managed resources should be disposed; otherwise, false.</param>
        protected override void Dispose(bool disposing)
        {
            if (disposing && (components != null))
            {
                components.Dispose();
            }
            base.Dispose(disposing);
        }

        #region Windows Form Designer generated code

        /// <summary>
        /// Required method for Designer support - do not modify
        /// the contents of this method with the code editor.
        /// </summary>
        private void InitializeComponent()
        {
            System.ComponentModel.ComponentResourceManager resources = new System.ComponentModel.ComponentResourceManager(typeof(FormPostBar));
            textBoxPost = new TextBox();
            buttonPost = new Button();
            SuspendLayout();
            // 
            // textBoxPost
            // 
            textBoxPost.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            textBoxPost.Enabled = false;
            textBoxPost.Location = new Point(12, 0);
            textBoxPost.MaxLength = 1024;
            textBoxPost.Name = "textBoxPost";
            textBoxPost.PlaceholderText = "Hello Nostr!";
            textBoxPost.Size = new Size(171, 23);
            textBoxPost.TabIndex = 6;
            textBoxPost.KeyDown += TextBoxPost_KeyDown;
            // 
            // buttonPost
            // 
            buttonPost.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            buttonPost.Enabled = false;
            buttonPost.Image = Properties.Resources.icons8_create_16;
            buttonPost.Location = new Point(189, 0);
            buttonPost.Name = "buttonPost";
            buttonPost.Size = new Size(23, 23);
            buttonPost.TabIndex = 7;
            buttonPost.UseVisualStyleBackColor = true;
            buttonPost.Click += ButtonPost_Click;
            // 
            // FormPostBar
            // 
            AutoScaleDimensions = new SizeF(7F, 15F);
            AutoScaleMode = AutoScaleMode.Font;
            ClientSize = new Size(224, 35);
            Controls.Add(buttonPost);
            Controls.Add(textBoxPost);
            Icon = (Icon)resources.GetObject("$this.Icon");
            KeyPreview = true;
            MaximizeBox = false;
            MaximumSize = new Size(480, 74);
            MinimizeBox = false;
            MinimumSize = new Size(200, 74);
            Name = "FormPostBar";
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            Text = "Post bar";
            TopMost = true;
            FormClosing += FormPostBar_FormClosing;
            Shown += FormPostBar_Shown;
            DoubleClick += FormPostBar_DoubleClick;
            KeyDown += FormPostBar_KeyDown;
            MouseClick += FormPostBar_MouseClick;
            MouseDown += FormPostBar_MouseDown;
            MouseMove += FormPostBar_MouseMove;
            ResumeLayout(false);
            PerformLayout();
        }

        #endregion
        internal Button buttonPost;
        internal TextBox textBoxPost;
    }
}