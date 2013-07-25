// constructor
function MPDisclosureVisualization(data, element){
    this.original_data = data
    this.generateUniqueIds(this.original_data)
    this.data = JSON.parse(JSON.stringify(data)); // quick and dirty clone

    // svg size settings
    this.width = 1200;
    this.height = 600;
    this.org_table_start_x = 220;
    this.mp_list_start_x = 10;

    this.y_scroll = 0;

    // initialize svg
    this.svg = element.append("svg:svg")
        .attr('width', this.width)
        .attr('height', this.height);
}

MPDisclosureVisualization.prototype.filterByDisclosureType = function(include_types){
    // reset to original data
    this.data = JSON.parse(JSON.stringify(this.original_data));

    // filter
    for(var i = 0; i < this.data.organizations.length;){
        for(var j = 0; j < this.data.organizations[i].children.length;){
          var matches_filter = false;
          for(t in include_types){
              if(this.data.organizations[i].children[j].disclosure_type == include_types[t])
                matches_filter = true;
          }
          if(!matches_filter)
               this.data.organizations[i].children.splice(j,1);
          else
               j++;
        }
       if(this.data.organizations[i].children.length == 0)
          this.data.organizations.splice(i,1);
        else
          i++;
    }
}


MPDisclosureVisualization.prototype.updateGraph = function(){
    // changes on a filter are large, so faster just to recreate
    this.svg.selectAll("*").remove();

    // update the nodes from the data
    this.layout = this.treemap();
    this.data_nodes = this.layout.nodes({ children: this.data.organizations });
    this.nodes = this.svg.selectAll("g.tree-node")
        .data(this.data_nodes, function(d){ return d.uid; });
    var enter_nodes = this.nodes.enter()
        .append("svg:g")
        .attr("class", function(d){ return d.type + " tree-node";});
    var exit_nodes = this.nodes.exit();

    // enter/exit/update the visualization components
    this.updateTreemap(enter_nodes, exit_nodes);
    this.updateMpList(enter_nodes, exit_nodes);
    this.updateLinks();
    this.updateScrollers();
    this.updateOrganizationTitles(this.data_nodes);
}

// tree map of organizations
MPDisclosureVisualization.prototype.updateTreemap = function(enter, exit){
    var vis = this;

    var org_enter_cells = enter.filter(function(d){ return d.type == "organization"; })
        .append("svg:g")
        .attr("class","org");
    org_enter_cells.append("svg:rect")

    // for the color of the parent organization, blend the underlying party colors
    var parties = ["conservative", "green", "new democratic", "liberal","bloc québécois","independent","unknown"];
    for(var i = 0; i < parties.length; i++){
      var rect = null;
      if(i == 0){
        rect = org_enter_cells.selectAll("rect");
      }
      else{
        rect = org_enter_cells.append("svg:rect");
      }

      rect.attr('class', "party-colours " + parties[i])
          .attr('opacity', function(d){
              var this_party_children = 0;
              var all_null = true;
              for(var j = 0; j < d.children.length; j++){
                if((d.children[j].party != null) && (d.children[j].party != ""))
                  all_null = false;
                if(d.children[j].party == parties[i])
                    this_party_children++;
              }
              if(all_null && (parties[i] == "unknown"))
                 return 0.7;
              return this_party_children / d.children.length * 0.7;
            });
    }

    exit.remove();

    // update locations and sizes
    this.svg.selectAll("g.org")
        .attr("transform", function(d) { return "translate(" + (d.x + vis.org_table_start_x) + "," + d.y + ")"; })
        .selectAll("rect")
          .attr("width", function(d) { return d.dx - 1; })
          .attr("height", function(d) { return d.dy - 1; });
}

// titles of organizations on the treemap (need to place separately, on top off all the other elements,
// for proper hover-over functionality)
MPDisclosureVisualization.prototype.updateOrganizationTitles = function(nodes){
    var vis = this;

    this.text_nodes = this.svg.selectAll("g.hover-text-node")
        .data(nodes.filter(function(d){return d.type == 'organization';}, function(d){ return d.uid; }));
    var enter_text_nodes = this.text_nodes.enter()
        .append("svg:g")
        .attr("class", "hover-text-node")
        .attr("transform", function(d) { return "translate(" + (d.x + vis.org_table_start_x) + "," + d.y + ")"; });
    enter_text_nodes.append("svg:rect")
        .attr("class", "text-placeholder")
        .attr("width", function(d) { return d.dx - 1; })
        .attr("height", function(d) { return d.dy - 1; })
        .on('click', function(d){
           vis.selectOrganization(d);
        });
    enter_text_nodes.append("svg:text")
        .attr("x", function(d) { return d.dx / 2; })
        .attr("y", function(d) { return d.dy / 2; })
        .attr("dy", ".35em")
        .attr("text-anchor", "middle")
        .text(function(d) { return d.id; })
        .attr("class", function(d) { return d.dx > this.getComputedTextLength() ? 'visible' : 'hidden_until_hover'; });
}

// left-hand-side list of MPs
MPDisclosureVisualization.prototype.updateMpList = function(enter, exit){
    var vis = this;

    // update the alphabetically index on all the mp nodes
    index = -1;
    prev_mp = "";
    this.mp_nodes = this.svg.selectAll("g.tree-node.mp")
        .sort(function(a,b){
          if(a.id < b.id)
            return -1;
          else if (a.id > b.id)
            return 1;
          return 0;
        })
        .each(function(d){
          if(d.id != prev_mp)
            index++;
          prev_mp = d.id;
          d.index = index;
        });

    // re-calculate x,y,dx and dy to position the MP on the side bar
    this.mp_nodes.each(function(d){

        d.x = vis.mp_list_start_x;
        d.dx = 180;
        d.y = vis.mpYpos(d);
        d.dy = 19;
    });

    var enter_cells = enter.filter(function(d){ return d.type == "mp"; })
        .append("svg:g")
        .attr("class", "mp-cell")
        .attr("transform", function(d) { return "translate(" + d.x + "," + d.y + ")"; });
    enter_cells.append("svg:rect")
        .attr("width", function(d) { return d.dx; })
        .attr("height", function(d) { return d.dy; })
        .attr("class", function(d){ return "party-colours " + d.party; })
        .on('click', function(d){
          vis.selectMP(d);
        });
    enter_cells.append("svg:text")
        .attr("x", 90)
        .attr("y", 10)
        .attr("dy", ".35em")
        .attr("text-anchor", "middle")
        .text(function(d) { return d.id; });

    exit.remove();
}

MPDisclosureVisualization.prototype.updateLinks = function(enter,exit){
    var vis = this;

    var link_data = this.layout.links(this.data_nodes).filter(function(d){return d.source.type != null;});
    this.links = this.svg.selectAll("g.link")
        .data(link_data);

    var diagonal_function = d3.svg.diagonal()
        .target(function(d){
            return {
                x: d.target.x + 180,
                y: d.target.y + 10 + vis.y_scroll
            };
        })
        .source(function(d){
            return {
                x: d.source.x + vis.org_table_start_x,
                y: d.source.y
            };
        });

    var enter_link_nodes = this.links.enter()
        .append("svg:g")
        .attr("class", "link");

    enter_link_nodes.append("svg:path")
        .attr("class", "link")
        .attr("shape-rendering", "auto");

    // markers and link info
    enter_link_nodes.append("svg:circle")
        .attr("class","marker")
        .attr("r", 5);
    enter_link_nodes.append("svg:text")
        .attr('class','info-icon')
        .attr("dy", ".35em")
        .attr("text-anchor", "middle")
        .text("?");
    enter_link_nodes.append("svg:text")
        .attr('class','info')
        .attr("dy", "-10px")
        .attr("text-anchor", "left")
        .text(function(d){return d.target.id + ": " + d.target.disclosure_text});

    this.links.exit().remove();

    // Update: link positions, which change upon a page up / page down
    this.links.selectAll("path.link")
        .attr("d",diagonal_function);
    this.links.datum(function(d){
        var path = d3.select(this).select('path.link')[0][0];

        // place halfway, or, if the point is off the page, place closer
        d.halfway = path.getPointAtLength(path.getTotalLength()*0.5);
        if((d.halfway.x > vis.width) || (d.halfway.y > vis.height))
            d.halfway = path.getPointAtLength(path.getTotalLength()*0.1);

        return d;
    });

    // For the update of the children, need to use make the updates from the parent where the datum
    // update took place because, other than the first run, the data updates don't propagate to the children
    // (d3 bug?)
    this.links.each(function(d){
        var parent = d3.select(this);
        parent.select("circle.marker")
            .attr("cx", d.halfway.x)
            .attr("cy", d.halfway.y);
        parent.selectAll("text.info, text.info-icon")
            .attr("x", d.halfway.x)
            .attr("y", d.halfway.y);
    });
}

// buttons for scrolling the list of MPs
MPDisclosureVisualization.prototype.updateScrollers = function(){
    var vis = this;

    // TODO: should just the scroll buttons to the top if they're already created
    this.svg.selectAll(".scroll").remove();

    // scroll up
    var nodes_to_scroll = this.svg.selectAll(".mp-cell");
    var scroll_up = function(){
        if(vis.y_scroll != 0){
            vis.y_scroll += vis.height-40;
            nodes_to_scroll.attr("transform", function(d) { return "translate(" + d.x + "," + vis.mpYpos(d)  + ")"; });
            vis.updateLinks();
        }
    };
    this.svg.append("svg:rect")
        .attr("class", "scroll up")
        .attr("width", 180)
        .attr("height", 20)
        .attr("x", 10)
        .on("click", function(){
            scroll_up();
        });
    this.svg.append("svg:text")
        .attr("class", "scroll text")
        .attr("x", 100)
        .attr("y", 10)
        .attr("dy", ".35em")
        .attr("text-anchor", "middle")
        .text("Page Up ▲");

    // scroll down
    var scroll_down = function(){
        // move down a page
        vis.y_scroll -= vis.height-40;
        nodes_to_scroll.attr("transform", function(d) { return "translate(" + d.x + "," + vis.mpYpos(d) + ")"; });
        vis.updateLinks();
    };
    this.svg.append("svg:rect")
        .attr("class", "scroll down")
        .attr("width", 180)
        .attr("height", 20)
        .attr("x", 10)
        .attr("y", this.height-20)
        .on("click", function(){
            scroll_down();
        });
    this.svg.append("svg:text")
        .attr("class", "scroll text")
        .attr("x", 100)
        .attr("y", this.height-10)
        .attr("dy", ".35em")
        .attr("text-anchor", "middle")
        .text("Page Down ▼");

}

// highlight an MP and associated orgs
MPDisclosureVisualization.prototype.selectMP = function(mp_data){
  var vis = this;
  this.deselect();

  var selected_links = this.links.filter(function(d){return d.target.id == mp_data.id});
  this.showLinks(selected_links);
}

// highlight an org and associated MPS
MPDisclosureVisualization.prototype.selectOrganization = function(org_data){
    var vis = this;
    this.deselect();

    var selected_links = this.links.filter(function(d){return d.source.id == org_data.id});
    this.showLinks(selected_links);
}

// show a set of selected links
MPDisclosureVisualization.prototype.showLinks = function(links){
  var vis = this;

  links.attr('class', 'link selected')
       .each(function(d){
          d.source.selected = true;
          d.target.selected = true;
       });

  // hover shields / activator around the link info icon
  links.each(function(d){
      var link = d3.select(this);
      vis.svg.append("svg:circle")
          .attr('class', 'hover-shield')
          .attr("r", 20)
          .attr("cx", d.halfway.x)
          .attr("cy", d.halfway.y)
          .on('mouseenter', function(){
              link.classed("hover", true);
          })
          .on('mouseleave', function(){
              link.classed("hover", false);
          });
  });

  // highlight MPs at the ends of the links
  this.nodes.filter(function(d){return d.selected && (d.type == 'mp');})
      .select('.mp-cell')
      .attr('class', 'mp-cell selected');

  // highlight organizations at the ends of the links
  this.nodes.filter(function(d){return d.selected && (d.type == 'organization');})
      .attr('class', 'tree-node organization selected')
      .selectAll('rect')
      .attr('opacity', function(d) { return (this.getAttribute('opacity') / 0.7); });

  // organization text nodes
  this.text_nodes.filter(function(d){return d.selected;})
      .attr('class', 'hover-text-node selected');
}

// deselect all MPs and organizations
MPDisclosureVisualization.prototype.deselect = function(){
    // clear all the selected class
    this.svg.selectAll(".selected").classed("selected", false);

    // remove the hover shields
    this.svg.selectAll("circle.hover-shield").remove();

    // reset organization cell opacities
    this.nodes.filter(function(d){return d.selected && (d.type == 'organization');})
        .selectAll('rect')
        .attr('opacity', function(d) { return (this.getAttribute('opacity') * 0.7); })
        .each(function(d){d.selected = false;});

    this.nodes.filter(function(d){return d.selected && (d.type == 'mp');})
        .each(function(d){d.selected = false;});
}

MPDisclosureVisualization.prototype.treemap = function(){
    return d3.layout.treemap()
        .round(false)
        .size([this.width-this.org_table_start_x-this.mp_list_start_x, this.height])
        .padding([4,4,4,4])
        .value(function(d){ return 1.0;});
}

// Y-position of an MP cell
MPDisclosureVisualization.prototype.mpYpos = function(d){
    return 20*d.index + this.y_scroll;
}

// generate unique ids for all the nodes in the data
MPDisclosureVisualization.prototype.generateUniqueIds = function(data){
    var id = 0;
    for(i in data.organizations){
      data.organizations[i].uid = id++;
      for(j in data.organizations[i].children){
          data.organizations[i].children[j].uid = id++;
      }
    }
}

