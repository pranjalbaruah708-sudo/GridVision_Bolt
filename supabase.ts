// Add this function to your supabase.ts file
generateTable('USERS', {
  emp_id: 'integer PRIMARY KEY',
  emp_name: 'text NOT NULL',
  Remarks: 'text'
});

function generateTable(tableName, columns) {
  const query = `CREATE TABLE IF NOT EXISTS ${tableName} (
    ${Object.entries(columns).map(([key, value]) => `${key} ${value}`).join(',\n')}
  );`;
  supabase.from('your_table_name').insert([{ query }]).then(response => {
    console.log(response);
  }).catch(error => {
    console.error(error);
  });
}