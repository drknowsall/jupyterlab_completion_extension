// import {
//   Cache,
// } from './Cache';

const { Configuration, OpenAIApi } = require('openai');
// const csv = require('csv-parser')
// const fs = require('fs')
// import {IConsoleTracker} from '@jupyterlab/console';
import { IDocumentManager } from '@jupyterlab/docmanager';
import { INotebookTracker } from '@jupyterlab/notebook';
import { Widget} from '@lumino/widgets';


interface IQueue<T> {
  enqueue(item: T): void;
  dequeue(): T | undefined;
  size(): number;
}

class Queue<T> implements IQueue<T> {
  private storage: T[] = [];

  constructor(private capacity: number = Infinity) {}

  enqueue(item: T): void {
    if (this.size() === this.capacity) {
      throw Error("Queue has reached max capacity, you cannot add more items");
    }
    this.storage.push(item);
  }
  dequeue(): T | undefined {
    return this.storage.shift();
  }

  clear()
      {
        while (this.storage.length > 0 && this.storage.pop());
      }
  size(): number {
    return this.storage.length;
  }
}

class Logger
{
  private queue : Queue<string>

  constructor() {
    this.queue = new Queue<string>();
  }

  set_message(str:string)
  {
    var currentdate = new Date();
    var str = "["
                + currentdate.getHours() + ":"
                + currentdate.getMinutes() + ":"
                + currentdate.getSeconds() + "] " + str;

    this.queue.enqueue(str);
  }

  print_messages()
  {
    let str = 'Prediction Log:\n';

    while (this.queue.size() > 0)
    {
      str += this.queue.dequeue() + '\n';
    }
    this.queue.clear();

    return str.slice(0, -1);
  }


}

function union(setA:Set<string>, setB:Set<string>) {
  const _union = new Set(setA);
  for (const elem of setB) {
    _union.add(elem);
  }
  return _union;
}

function intersection(setA:Set<string>, setB:Set<string>) {
  const _intersection = new Set();
  for (const elem of setB) {
    if (setA.has(elem)) {
      _intersection.add(elem);
    }
  }
  return _intersection;
}

function replaceAll(str:string, find:string, replace:string) {
  return str.replace(new RegExp(find, 'g'), replace);
}

function jaccard_similarity(text_a: string, text_b: string)
{

  let sentences_a = new Set<string>();

  for (const sent of text_a.split('\n'))
  {

     for (const word of sent.split(' '))
      {
        sentences_a.add(word);
      }
  }

  let sentences_b = new Set<string>();

  for (const sent of text_b.split('\n'))
  {
     for (const word of sent.split(' '))
      {
        sentences_b.add(word);
      }
  }

  const intersection_cardinality = intersection(sentences_a, sentences_b).size;

  const union_cardinality = union(sentences_a, sentences_b).size;

  return intersection_cardinality / union_cardinality;
}



function hashCode(str: string) {
  var hash = 0,
    i,
    chr;
  if (str.length === 0) return hash;
  for (i = 0; i < str.length; i++) {
    chr = str.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0; // Convert to 32bit integer
  }
  return hash;
}

export class codex_model {
  openai: any;
  params: any;
  api_key: any;
  cache_cmp: any;
  cache_exp: any;
  messages: Logger;
  tokens_sent: number;
  tokens_recieved: number;
  constructor(
    codex_params = {
      model: 'code-davinci-002',
      temperature: 0,
      max_tokens: 256,
      frequency_penalty: 2,
      presence_penalty: 1,
      best_of: 1,
      stop: ['# In[']
    }) {
    this.tokens_sent = 0;
    this.tokens_recieved = 0;
    this.params = {
      add_comments:true,
      add_codex_annotation:true,
      extract_selective:false,
      append_markdown: false,
      append_notebook_cell_borders: true,
      append_dataset_meta: true,
      append_output: false,
      window_size: 3,
      model_name: 'codex',
      model: codex_params
    };
    this.cache_cmp = {};
    this.cache_exp = {};

    this.messages = new Logger()
  }

  async add_comments(notebooks: INotebookTracker)
  {
        let cells = notebooks.currentWidget!.content.model!.cells;

        let md_cell = this.get_markdown(notebooks, 'Please wait for completion..', 'blue');

        cells.push(md_cell);

        for (let l = 0; l < cells.length-1; l++)
        {
          if (cells.get(l).type == 'markdown' || cells.get(l).value.text.trim()[0] == '#') continue;

          let cell_source = cells.get(l).value.text.trim() + '\n';
          cell_source=cell_source.replace(/""".*"""\n/, '');
          cell_source=cell_source.replace('\n""""""', '');

          let exp = await this.codex_explain_call(cell_source);

          if ((exp.trim()[0] == '#' || exp.trim()[0] == '//' ) && exp.length > 3)
          {
              exp = replaceAll(exp, '//', '#')
              exp = replaceAll(exp, 'above', 'below')
              exp = replaceAll(exp, 'It', '').replace(/\s\s+/g, ' ').trim();

              let comment = '';
              for (let l of exp.split('\n'))
              {
                if (l.length > 3)
                {
                  comment += l + '\n';
                }
              }

              cells.get(l).value.text = '"""Predicted With Codex"""\n' + comment + cell_source + '""""""';
          }
      }

        cells.remove(cells.length-1);
    }

  async add_markdown_templates(
    notebooks: INotebookTracker,
    doc_manager: IDocumentManager
  ) {
    let append_meta = this.params['append_dataset_meta'];
    let append_import = true;
    let append_train = true;
    let append_test = true;
    let append_visual = true;
    let append_explore = true;
    let cells = notebooks.currentWidget!.content.model!.cells;
    let cells_i = []

    for (let l = 0; l < cells.length; l++) {
      let cell_source = cells.get(l).value.text.trim() + '\n';
      if (
        cell_source.indexOf('Table ') >= 0 &&
        cell_source.indexOf(', columns = [') >= 0
      ) {
        append_meta = false;
      }
      if (cell_source.indexOf('Importing relevant libraries') >= 0) {
        append_import = false;
      }
      if (cell_source.indexOf('Training the model') >= 0) {
        append_train = false;
      }
        if (cell_source.indexOf('Data Exploration') >= 0) {
        append_explore = false;
      }
       if (cell_source.indexOf('Visualization') >= 0) {
        append_visual = false;
      }
      if (cell_source.indexOf('Testing the model') >= 0) {
        append_test = false;
      }

      if (append_meta && cell_source.indexOf('read_csv') >= 0) {

        let fname_i1 = cell_source.indexOf("read_csv('") + "read_csv('".length;
        let fname_i2 = cell_source.indexOf("')");
        if (fname_i2 < 0)
        {
          fname_i2 = cell_source.indexOf("\")");
        }

        let fname = cell_source.substring(fname_i1, fname_i2);
        let file;
        try
        {
          file = await doc_manager.services.contents.get(fname);
        } catch (e) {
          file = null;
        }

        if (file)
        {
          let table_name = fname.replace('.csv', '').split('/').pop();
          let columns = file.content
            .split('\n')[0]
            .split(',')
            .filter((value: string) => {
              return value != '';
            });
          let dataset_meta =
            'Table ' + table_name + ', columns = [' + columns.join(' ,') + ']';

          if (l == 0 || append_explore){
            let cell = this.get_markdown(notebooks, 'Data Exploration', 'black');
            cells.insert(l, cell);
            l++;
            append_explore = false;

          }

          let cell = this.get_markdown(notebooks, dataset_meta, 'black');
          cells_i.push(l+1);
          cells.insert(l, cell);
          l++;
        }
        else if(l == 0 || append_explore)
        {
          let cell = this.get_markdown(notebooks, 'Data Exploration', 'black');
          cells_i.push(l+1);
          cells.insert(l, cell);
          l += 1;
          append_explore = false;
        }

      } else if (
        append_import &&
        (cell_source.match(/import/g) || []).length >= 2 || ((cell_source.match(/import/g) || []).length < 2 && cell_source.split('\n').length < 2)
      ) {
        const cell = this.get_markdown(notebooks, 'Importing relevant libraries', 'black');
        cells_i.push(l+1);
        cells.insert(l, cell);
        l += 1;
      } else if (append_train && cell_source.indexOf('train') >= 0) {
        const cell = this.get_markdown(notebooks, 'Training the model', 'black');
        cells_i.push(l+1);
        cells.insert(l, cell);
        l += 1;
      }
      else if (append_visual && (cell_source.indexOf('plot') >= 0 || cell_source.indexOf('hist') >= 0 )) {
        const cell = this.get_markdown(notebooks, 'Visualization', 'black');
        cells_i.push(l+1);
        cells.insert(l, cell);
        l += 1;
      }
      else if (
        (append_test && cell_source.indexOf('test') >= 0) ||
        cell_source.indexOf('eval') >= 0 ||
        cell_source.indexOf('score') >= 0
      ) {
        const cell = this.get_markdown(notebooks, 'Testing the model', 'black');
        cells_i.push(l+1);
        cells.insert(l, cell);
        l += 1;
      }
    }
    let cells_str = '[]';
    if (cells_i.length > 0)
    {
      cells_str = cells_i.map(String).join(', ')
    }
    this.messages.set_message('Adding Template Markdowns to Cells:' + cells_str);
  }

  extract_input_selective(notebooks: any, in_cell: boolean): string {
    let cells = notebooks.currentWidget.content.model.cells;

     if (cells.length == 1)
        return this.extract_input(notebooks, in_cell);

    let cells_content: string[] = [];

    let append_borders = this.params['append_notebook_cell_borders'];

    let max_sim = 0.;
    let min_sim = 1.;
    //let sum_sim = 0.;

    let c0 = cells.get(cells.length-1).value.text.trim();

    for (let l = 0 ; l < cells.length-1; l++) {
      let c1 = cells.get(l).value.text.trim();
      let s = jaccard_similarity(c0, c1)
      if (s < min_sim)
        min_sim = s
      if (s > max_sim)
        max_sim = s
      //sum_sim += s
    }
    //let avg_sim = sum_sim / cells.length

    let k = 0 ;
    for (let l = 0 ; l < cells.length; l++) {
      let cell_source = cells.get(l).value.text.trim();


      if (max_sim != min_sim && jaccard_similarity(c0, cell_source) / max_sim < 0.1)
            continue

      cell_source = cell_source + '\n';

      if (cells.get(l).type =='markdown' && cell_source.indexOf('<') >=0)
      {
        cell_source = '# ' + cell_source.substring(
          cell_source.indexOf(">") + 1,
          cell_source.lastIndexOf("<")
          ).trim() + '\n';

      }
      //
      // if (cell_source.indexOf('[Created by codex]') >= 0) {
      //   continue;
      // }


      if (append_borders) {
        cell_source = '# In[' + k + ']:\n' + cell_source;
      }

      cells_content.push(cell_source);
      k += 1;
    }

    let model_input = cells_content.join('').trim();

    if (!in_cell && append_borders) {
      model_input = model_input + '\n' + '# In[' + k + ']:\n';
    }

    return model_input;
  }

  remove_comments(notebooks: any, statusWidget: Widget)
  {
    statusWidget.node.textContent = 'removing comments..';

    let cells = notebooks.currentWidget.content.model.cells;
    for (let l = 0; l < cells.length; l++) {
      let cell_source = cells.get(l).value.text.trim();
      cell_source = cell_source.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g,'').trim();

      cell_source = cell_source.replace(/#.*/g,'').trim();
      cells.get(l).value.text = cell_source;
    }
    statusWidget.node.textContent = 'done!';
  }

  extract_input(notebooks: any, in_cell: boolean): string {
    let cells = notebooks.currentWidget.content.model.cells;
    let cells_content: string[] = [];

    let append_borders = this.params['append_notebook_cell_borders'];
    let l = Math.max(0, cells.length - this.params['window_size']);
    let cells_i = [];

    for (; l < cells.length; l++) {

      cells_i.push(l);
      let cell_source = cells.get(l).value.text.trim() + '\n';

      cell_source=cell_source.replace(/""".*"""\n/, '');
      cell_source=cell_source.replace('\n""""""', '');
      if (cells.get(l).type =='markdown' && cell_source.indexOf('<') >=0)
      {
        cell_source =  '# ' + cell_source.substring(
          cell_source.indexOf(">") + 1,
          cell_source.lastIndexOf("<")
          ).trim() + '\n';
      }

      // if (cell_source.indexOf('[Created by codex]') >= 0) {
      //   continue;
      // }

      if (append_borders) {
        cell_source = '# In[' + l + ']:\n' + cell_source;
      }

      cells_content.push(cell_source);
    }

    let model_input = cells_content.join('').trim();

    if (!in_cell && append_borders) {
      model_input = model_input + '\n' + '# In[' + l + ']:\n';
    }

    let cells_str = '[]';
    if (cells_i.length > 0)
    {
      cells_str = cells_i.map(String).join(', ')
    }

    this.messages.set_message('Extracting Input Cells: ' + cells_str);
    return model_input;
  }
  //
  // add_to_file_log(doc_manager:IDocumentManager, content:string, fname='codexnb')
  // {
  //    let doc_file = doc_manager.openOrReveal('codexnb');
  //    doc_file!.node.textContent += 'heeeeelllllooooo';
  //    doc_manager.openOrReveal('Untitled.ipynb');
  // }

         async read_conf(notebooks: INotebookTracker, statusWidget: Widget)
  {

        console.log('Codex: reading conf..');
        statusWidget.node.textContent = 'Codex: reading conf..';
        const model = notebooks.currentWidget!.content.model!;
        if (model.cells.length ==0)
        {
          return;
        }
        let str_params = model.cells.get(model.cells.length-1).value.text;

        let params = JSON.parse(str_params);

        this.params =  params;
        // this.params = params;

        const configuration = new Configuration({
        apiKey: this.params['api_key']
        });

        this.openai = new OpenAIApi(configuration);
        model.cells.remove(model.cells.length-1);
        model.cells.remove(model.cells.length-1);
        console.log('Codex: conf read successfully!');
        statusWidget.node.textContent = 'Codex: conf read successfully!';
        return
  }

  get_markdown(notebooks: INotebookTracker, text:string, color:string, size= 5)
  {
        const model = notebooks.currentWidget!.content.model!;
        let md_cell = model.contentFactory.createMarkdownCell({});

        md_cell.value.text = "<font color=\'" + color  + "\'" + " size=\'" + size.toString()  + "px" + "\'" + ">" + replaceAll(text, '#', '') + '</font>';
        return md_cell;
  }

  async set_conf(notebooks: INotebookTracker, statusWidget: Widget)
  {
        console.log('Codex: set conf..');
        statusWidget.node.textContent = 'Codex: set conf..';
        const model = notebooks.currentWidget!.content.model!;

        let md_cell = this.get_markdown(notebooks, 'Add Codexnb configurations:', 'black');

        model.cells.push(md_cell);

        let cell = model.contentFactory.createCodeCell({});

        let params = this.params;
        if (!('api_key' in params))
        {
          params['api_key'] = '';
        }

        cell.value.text = JSON.stringify(params,null, "\t");

        model.cells.push(cell);
  }

  show_flow_output(notebooks: INotebookTracker, statusWidget: Widget)
  {
        console.log('Codex: show flow output..');
        statusWidget.node.textContent = 'Codex: show flow output..';
        const model = notebooks.currentWidget!.content.model!;

        let raw_cell = model.contentFactory.createRawCell({});
        raw_cell.value.text = this.messages.print_messages();

        model.cells.push(raw_cell);
  }
  async predict(
    notebooks: INotebookTracker,
    doc_manager: IDocumentManager,
    statusWidget: Widget,
    in_cell: boolean
  ) {
    console.log('Codex: extracting input..');


    statusWidget.node.textContent = 'Codex: add comments..';

    if (this.params['add_comments'])  {
      await this.add_markdown_templates(notebooks, doc_manager);
    }

    let codex_input;
    statusWidget.node.textContent = 'Codex: extracting input..';
    if (this.params['extract_selective'])
    {
      codex_input = this.extract_input_selective(notebooks, in_cell);
    }
    else
    {
      codex_input = this.extract_input(notebooks, in_cell);
    }

    let cell;
    statusWidget.node.textContent = 'Codex: Calling API (num tokens= ' + codex_input.length.toString() + ")";
    this.messages.set_message('Calling Codex, #Input Tokens = ' + codex_input.length.toString());

    const cells = notebooks.currentWidget!.content.model!.cells;

    cells.push(this.get_markdown(notebooks, 'Please wait for completion..', 'blue'));


    let codex_output = await this.codex_completion_call(codex_input);

    cells.remove(cells.length-1);

    if (codex_output.indexOf('In[') >= 0)
    {
      codex_output = codex_output.slice(0, codex_output.indexOf('In['))
    }
    const model = notebooks.currentWidget!.content.model!;

    this.messages.set_message('Codex Response, #Output Tokens= ' + codex_output.length.toString());

    let last_cell = model.cells.get(model.cells.length - 1).value.text.trim();
    if (model.cells.get(model.cells.length - 1).type =='markdown' && last_cell.indexOf('<') >=0)
      {
        last_cell = '# ' + last_cell.substring(
          last_cell.indexOf(">") + 1,
          last_cell.lastIndexOf("<")
          ).trim();

      }

    if (last_cell == codex_output.trim())
     {
       statusWidget.node.textContent = 'output is identical to previous cell - ignore';
       this.messages.set_message('Output is Identical to Previous Cell - Ignoring');
       return;
    }

    let index = /[a-z]/i.exec(codex_output)!.index;

    if (index > 0 && codex_output.trim()[0] != '#'){
      in_cell = true;
    }
    if (in_cell)
    {
      let cell_source = model.cells.get(model.cells.length - 1).value.text;

      cell_source=cell_source.replace('\n""""""', '');

      while (cell_source.length > 0 && cell_source[cell_source.length-1] == '\n')
      {
        cell_source = cell_source.slice(0, cell_source.length-1);
      }

      while (codex_output.length > 0 && codex_output[codex_output.length-1] == '\n')
      {
        codex_output = codex_output.slice(0, codex_output.length-1);
      }

      model.cells.get(model.cells.length - 1).value.text = cell_source + codex_output + '\n""""""';;
    }
    else
    {
        codex_output = codex_output.trim();
        if (codex_output.indexOf('#') == 0 &&
          codex_output.charAt(2) == codex_output.charAt(2).toUpperCase()
        ) {
          this.messages.set_message('Output Contains A Markdown Cell');
          let lines = codex_output.split('\n');

          cell = this.get_markdown(notebooks, lines[0], 'black');

          model.cells.push(cell);

          if (lines.length > 1) {
            this.messages.set_message('Output Contains A Code Block');
            codex_output = lines.slice(1).join('\n').trim();

            cell = model.contentFactory.createCodeCell({});
            codex_output = '"""Predicted With Codex"""\n' + codex_output;
            cell.value.text = codex_output;

            model.cells.push(cell);
          }
        } else {
          cell = model.contentFactory.createCodeCell({});
          codex_output = '"""Predicted With Codex"""\n' + codex_output;
          cell.value.text = codex_output;
          this.messages.set_message('Output Contains A Code Block');
          model.cells.push(cell);
        }
    }
    console.log(
      'Codex: predict, #tokens= ' + codex_input.length + ' input =\n' +
        codex_input +
        '\n' +
        'output =\n' +
        codex_output
    );
    this.tokens_sent += codex_input.length;
    this.tokens_recieved += codex_output.length;
    this.messages.set_message('Total Tokens Sent in This Session: ' + this.tokens_sent.toString());
    this.messages.set_message('Total Tokens Received in This Session: ' + this.tokens_recieved.toString());
    statusWidget.node.textContent = 'Codex: predicted successfully,(num tokens= ' + codex_output.length + ")";
  }

  async codex_completion_call(text: string): Promise<string> {
    const h = hashCode(text);
    if (h in this.cache_cmp) {
      this.messages.set_message('Cache Used');
      return this.cache_cmp[h];
    }

    let params = this.params['model'];
    params['prompt'] = text;

    const output = await this.openai.createCompletion(params);


    var result = output.data.choices[0].text;

    this.cache_cmp[h] = result;

    return result;
  }

  async codex_explain_call(text: string): Promise<string> {

    const h = hashCode(text);
    if (h in this.cache_exp) {
      return this.cache_exp[h];
    }

    text += '\n# What the code does?';
    let params = {
      model: 'code-davinci-002',
      prompt: text,
      temperature: 0,
      max_tokens: 50,
      frequency_penalty: 2,
      presence_penalty: 0,
      best_of: 3,
      stop: ['\n\n']
    };

    const output = await this.openai.createCompletion(params);
    const result = output.data.choices[0].text.trim();
    this.cache_exp[h] = result;
    return result;
  }
}
