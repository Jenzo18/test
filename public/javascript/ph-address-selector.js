/**
 * __________________________________________________________________
 *
 * Philippine Address Selector
 * __________________________________________________________________
 *
 * MIT License
 * 
 * Copyright (c) 2020 Wilfred V. Pine
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 * @package Philippine Address Selector
 * @author Wilfred V. Pine <only.master.red@gmail.com>
 * @copyright Copyright 2020 (https://dev.confired.com)
 * @link https://github.com/redmalmon/philippine-address-selector
 * @license https://opensource.org/licenses/MIT MIT License
 */

var my_handlers = {
    // fill cities
    fill_cities: function() {
        // selected city
        var city_code = $(this).val();

        // set selected text to input
        var city_text = $(this).find("option:selected").text();
        let city_input = $('#city-text');
        city_input.val(city_text);
        //clear barangay input
        $('#barangay-text').val('');

        // barangay
        let dropdown = $('#barangay');
        dropdown.empty();
        dropdown.append('<option selected="true" disabled>Choose barangay</option>');
        dropdown.prop('selectedIndex', 0);

        // filter & Fill
        var url = '/ph_json/barangay.json';
        $.getJSON(url, function(data) {
            var result = data.filter(function(value) {
                return value.city_code == city_code;
            });

            result.sort(function(a, b) {
                return a.brgy_name.localeCompare(b.brgy_name);
            });

            $.each(result, function(key, entry) {
                dropdown.append($('<option></option>').attr('value', entry.brgy_code).text(entry.brgy_name));
            })

        });
    },

    onchange_barangay: function() {
        // set selected text to input
        var barangay_text = $(this).find("option:selected").text();
        let barangay_input = $('#barangay-text');
        barangay_input.val(barangay_text);
    },
};

$(function() {
    // events
    $('#city').on('change', function() {
        $('#barangay-container').show();
        $('#street-container').hide();
        my_handlers.fill_cities.call(this);
    });

    $('#barangay').on('change', function() {
        $('#street-container').show();
        my_handlers.onchange_barangay.call(this);
    });

    // Initialize visibility
    $('#barangay-container, #street-container').hide();

    // load cities
    let dropdown = $('#city');
    dropdown.empty();
    dropdown.append('<option selected="true" disabled>Choose City/Municipality</option>');
    dropdown.prop('selectedIndex', 0);
    const url = '/ph_json/city.json';
    // Populate dropdown with a list of cities
    $.getJSON(url, function(data) {
        var result = data.sort(function(a, b) {
            return a.city_name.localeCompare(b.city_name);
        });

        $.each(result, function(key, entry) {
            dropdown.append($('<option></option>').attr('value', entry.city_code).text(entry.city_name));
        });
    });
});
