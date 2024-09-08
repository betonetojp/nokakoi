namespace nokakoi
{
    partial class FormRelayList
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
            System.ComponentModel.ComponentResourceManager resources = new System.ComponentModel.ComponentResourceManager(typeof(FormRelayList));
            dataGridViewRelayList = new DataGridView();
            Ennabled = new DataGridViewCheckBoxColumn();
            RelayUrl = new DataGridViewTextBoxColumn();
            buttonSave = new Button();
            buttonDelete = new Button();
            ((System.ComponentModel.ISupportInitialize)dataGridViewRelayList).BeginInit();
            SuspendLayout();
            // 
            // dataGridViewRelayList
            // 
            dataGridViewRelayList.AllowUserToResizeRows = false;
            dataGridViewRelayList.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
            dataGridViewRelayList.ColumnHeadersHeightSizeMode = DataGridViewColumnHeadersHeightSizeMode.AutoSize;
            dataGridViewRelayList.ColumnHeadersVisible = false;
            dataGridViewRelayList.Columns.AddRange(new DataGridViewColumn[] { Ennabled, RelayUrl });
            dataGridViewRelayList.Location = new Point(12, 12);
            dataGridViewRelayList.MultiSelect = false;
            dataGridViewRelayList.Name = "dataGridViewRelayList";
            dataGridViewRelayList.RowHeadersVisible = false;
            dataGridViewRelayList.SelectionMode = DataGridViewSelectionMode.FullRowSelect;
            dataGridViewRelayList.ShowCellToolTips = false;
            dataGridViewRelayList.Size = new Size(260, 208);
            dataGridViewRelayList.TabIndex = 0;
            // 
            // Ennabled
            // 
            Ennabled.AutoSizeMode = DataGridViewAutoSizeColumnMode.AllCells;
            Ennabled.HeaderText = "";
            Ennabled.Name = "Ennabled";
            Ennabled.Width = 21;
            // 
            // RelayUrl
            // 
            RelayUrl.AutoSizeMode = DataGridViewAutoSizeColumnMode.Fill;
            RelayUrl.HeaderText = "";
            RelayUrl.Name = "RelayUrl";
            RelayUrl.Resizable = DataGridViewTriState.True;
            RelayUrl.SortMode = DataGridViewColumnSortMode.NotSortable;
            // 
            // buttonSave
            // 
            buttonSave.Anchor = AnchorStyles.Bottom | AnchorStyles.Right;
            buttonSave.DialogResult = DialogResult.OK;
            buttonSave.Location = new Point(197, 226);
            buttonSave.Name = "buttonSave";
            buttonSave.Size = new Size(75, 23);
            buttonSave.TabIndex = 2;
            buttonSave.Text = "Save";
            buttonSave.UseVisualStyleBackColor = true;
            buttonSave.Click += ButtonSave_Click;
            // 
            // buttonDelete
            // 
            buttonDelete.Anchor = AnchorStyles.Bottom | AnchorStyles.Left;
            buttonDelete.Location = new Point(12, 226);
            buttonDelete.Name = "buttonDelete";
            buttonDelete.Size = new Size(75, 23);
            buttonDelete.TabIndex = 1;
            buttonDelete.Text = "Delete";
            buttonDelete.UseVisualStyleBackColor = true;
            buttonDelete.Click += ButtonDelete_Click;
            // 
            // FormRelayList
            // 
            AutoScaleDimensions = new SizeF(96F, 96F);
            AutoScaleMode = AutoScaleMode.Dpi;
            ClientSize = new Size(284, 261);
            Controls.Add(buttonDelete);
            Controls.Add(buttonSave);
            Controls.Add(dataGridViewRelayList);
            Icon = (Icon)resources.GetObject("$this.Icon");
            MaximizeBox = false;
            MinimizeBox = false;
            MinimumSize = new Size(300, 300);
            Name = "FormRelayList";
            ShowInTaskbar = false;
            SizeGripStyle = SizeGripStyle.Show;
            StartPosition = FormStartPosition.CenterParent;
            Text = "Relay list";
            TopMost = true;
            Load += FormRelayList_Load;
            ((System.ComponentModel.ISupportInitialize)dataGridViewRelayList).EndInit();
            ResumeLayout(false);
        }

        #endregion

        private DataGridView dataGridViewRelayList;
        private Button buttonSave;
        private DataGridViewCheckBoxColumn Ennabled;
        private DataGridViewTextBoxColumn RelayUrl;
        private Button buttonDelete;
    }
}