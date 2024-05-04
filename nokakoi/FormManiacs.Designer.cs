namespace nokakoi
{
    partial class FormManiacs
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
            DataGridViewCellStyle dataGridViewCellStyle1 = new DataGridViewCellStyle();
            System.ComponentModel.ComponentResourceManager resources = new System.ComponentModel.ComponentResourceManager(typeof(FormManiacs));
            dataGridViewUsers = new DataGridView();
            mute = new DataGridViewCheckBoxColumn();
            display_name = new DataGridViewTextBoxColumn();
            name = new DataGridViewTextBoxColumn();
            nip05 = new DataGridViewTextBoxColumn();
            pubkey = new DataGridViewTextBoxColumn();
            buttonSave = new Button();
            checkBoxBalloon = new CheckBox();
            checkBoxOpenFile = new CheckBox();
            labelFileName = new Label();
            textBoxFileName = new TextBox();
            textBoxKeywords = new TextBox();
            labelKeywords = new Label();
            ((System.ComponentModel.ISupportInitialize)dataGridViewUsers).BeginInit();
            SuspendLayout();
            // 
            // dataGridViewUsers
            // 
            dataGridViewUsers.AllowUserToAddRows = false;
            dataGridViewUsers.AllowUserToDeleteRows = false;
            dataGridViewUsers.AllowUserToResizeRows = false;
            dataGridViewUsers.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
            dataGridViewCellStyle1.Alignment = DataGridViewContentAlignment.MiddleLeft;
            dataGridViewCellStyle1.BackColor = SystemColors.Control;
            dataGridViewCellStyle1.Font = new Font("Yu Gothic UI", 9F);
            dataGridViewCellStyle1.ForeColor = SystemColors.WindowText;
            dataGridViewCellStyle1.SelectionBackColor = SystemColors.Highlight;
            dataGridViewCellStyle1.SelectionForeColor = SystemColors.HighlightText;
            dataGridViewCellStyle1.WrapMode = DataGridViewTriState.True;
            dataGridViewUsers.ColumnHeadersDefaultCellStyle = dataGridViewCellStyle1;
            dataGridViewUsers.ColumnHeadersHeightSizeMode = DataGridViewColumnHeadersHeightSizeMode.AutoSize;
            dataGridViewUsers.Columns.AddRange(new DataGridViewColumn[] { mute, display_name, name, nip05, pubkey });
            dataGridViewUsers.Location = new Point(12, 12);
            dataGridViewUsers.MultiSelect = false;
            dataGridViewUsers.Name = "dataGridViewUsers";
            dataGridViewUsers.RowHeadersVisible = false;
            dataGridViewUsers.SelectionMode = DataGridViewSelectionMode.FullRowSelect;
            dataGridViewUsers.ShowCellToolTips = false;
            dataGridViewUsers.Size = new Size(440, 325);
            dataGridViewUsers.StandardTab = true;
            dataGridViewUsers.TabIndex = 0;
            dataGridViewUsers.SelectionChanged += dataGridViewUsers_SelectionChanged;
            // 
            // mute
            // 
            mute.AutoSizeMode = DataGridViewAutoSizeColumnMode.ColumnHeader;
            mute.HeaderText = "mute";
            mute.Name = "mute";
            mute.Width = 40;
            // 
            // display_name
            // 
            display_name.HeaderText = "display_name";
            display_name.MinimumWidth = 20;
            display_name.Name = "display_name";
            display_name.ReadOnly = true;
            display_name.Width = 110;
            // 
            // name
            // 
            name.HeaderText = "name";
            name.MinimumWidth = 20;
            name.Name = "name";
            name.ReadOnly = true;
            name.Width = 110;
            // 
            // nip05
            // 
            nip05.HeaderText = "nip05";
            nip05.MinimumWidth = 20;
            nip05.Name = "nip05";
            nip05.ReadOnly = true;
            nip05.Width = 110;
            // 
            // pubkey
            // 
            pubkey.AutoSizeMode = DataGridViewAutoSizeColumnMode.Fill;
            pubkey.HeaderText = "pubkey";
            pubkey.MinimumWidth = 20;
            pubkey.Name = "pubkey";
            pubkey.ReadOnly = true;
            // 
            // buttonSave
            // 
            buttonSave.Anchor = AnchorStyles.Bottom | AnchorStyles.Right;
            buttonSave.Location = new Point(377, 406);
            buttonSave.Name = "buttonSave";
            buttonSave.Size = new Size(75, 23);
            buttonSave.TabIndex = 5;
            buttonSave.Text = "Save";
            buttonSave.UseVisualStyleBackColor = true;
            buttonSave.Click += ButtonSave_Click;
            // 
            // checkBoxBalloon
            // 
            checkBoxBalloon.Anchor = AnchorStyles.Bottom | AnchorStyles.Left;
            checkBoxBalloon.AutoSize = true;
            checkBoxBalloon.Location = new Point(12, 356);
            checkBoxBalloon.Name = "checkBoxBalloon";
            checkBoxBalloon.Size = new Size(129, 19);
            checkBoxBalloon.TabIndex = 1;
            checkBoxBalloon.Text = "Balloon notification";
            checkBoxBalloon.UseVisualStyleBackColor = true;
            // 
            // checkBoxOpenFile
            // 
            checkBoxOpenFile.Anchor = AnchorStyles.Bottom | AnchorStyles.Left;
            checkBoxOpenFile.AutoSize = true;
            checkBoxOpenFile.Location = new Point(12, 381);
            checkBoxOpenFile.Name = "checkBoxOpenFile";
            checkBoxOpenFile.Size = new Size(136, 19);
            checkBoxOpenFile.TabIndex = 2;
            checkBoxOpenFile.Text = "Open file notification";
            checkBoxOpenFile.UseVisualStyleBackColor = true;
            // 
            // labelFileName
            // 
            labelFileName.Anchor = AnchorStyles.Bottom | AnchorStyles.Left;
            labelFileName.AutoSize = true;
            labelFileName.Location = new Point(12, 409);
            labelFileName.Name = "labelFileName";
            labelFileName.Size = new Size(57, 15);
            labelFileName.TabIndex = 0;
            labelFileName.Text = "File name";
            // 
            // textBoxFileName
            // 
            textBoxFileName.Anchor = AnchorStyles.Bottom | AnchorStyles.Left;
            textBoxFileName.Location = new Point(75, 406);
            textBoxFileName.Name = "textBoxFileName";
            textBoxFileName.Size = new Size(138, 23);
            textBoxFileName.TabIndex = 3;
            textBoxFileName.Text = "https://nostter.app/";
            // 
            // textBoxKeywords
            // 
            textBoxKeywords.Anchor = AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
            textBoxKeywords.Location = new Point(219, 375);
            textBoxKeywords.Multiline = true;
            textBoxKeywords.Name = "textBoxKeywords";
            textBoxKeywords.ScrollBars = ScrollBars.Vertical;
            textBoxKeywords.Size = new Size(152, 54);
            textBoxKeywords.TabIndex = 4;
            // 
            // labelKeywords
            // 
            labelKeywords.Anchor = AnchorStyles.Bottom | AnchorStyles.Left;
            labelKeywords.AutoSize = true;
            labelKeywords.Location = new Point(219, 357);
            labelKeywords.Name = "labelKeywords";
            labelKeywords.Size = new Size(108, 15);
            labelKeywords.TabIndex = 0;
            labelKeywords.Text = "Keywords (per line)";
            // 
            // FormManiacs
            // 
            AutoScaleDimensions = new SizeF(96F, 96F);
            AutoScaleMode = AutoScaleMode.Dpi;
            ClientSize = new Size(464, 441);
            Controls.Add(labelKeywords);
            Controls.Add(textBoxKeywords);
            Controls.Add(textBoxFileName);
            Controls.Add(labelFileName);
            Controls.Add(checkBoxOpenFile);
            Controls.Add(checkBoxBalloon);
            Controls.Add(buttonSave);
            Controls.Add(dataGridViewUsers);
            Icon = (Icon)resources.GetObject("$this.Icon");
            Name = "FormManiacs";
            StartPosition = FormStartPosition.CenterScreen;
            Text = "Mute and keyword notification";
            FormClosing += FormManiacs_FormClosing;
            Load += FormUsers_Load;
            ((System.ComponentModel.ISupportInitialize)dataGridViewUsers).EndInit();
            ResumeLayout(false);
            PerformLayout();
        }

        #endregion

        private DataGridView dataGridViewUsers;
        private Button buttonSave;
        private CheckBox checkBoxBalloon;
        private CheckBox checkBoxOpenFile;
        private Label labelFileName;
        private TextBox textBoxFileName;
        private TextBox textBoxKeywords;
        private Label labelKeywords;
        private DataGridViewCheckBoxColumn mute;
        private DataGridViewTextBoxColumn display_name;
        private DataGridViewTextBoxColumn name;
        private DataGridViewTextBoxColumn nip05;
        private DataGridViewTextBoxColumn pubkey;
    }
}